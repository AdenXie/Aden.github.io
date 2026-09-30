"""Build local reading fonts using the characters in the generated site."""

import shutil
import sys
from html.parser import HTMLParser
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont


# Chinese pages draw these with the Han fonts (see lib/styles/fonts.css).
CJK_PUNCTUATION = {0x2014, 0x201C, 0x201D, 0x2026}


class PageText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.skip = False
        self.points = set()

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style"}:
            self.skip = True
        # Placeholders are drawn with the page font, unlike title tooltips.
        for name, value in attrs:
            if name == "placeholder" and value:
                self.points.update(ord(c) for c in value if ord(c) >= 0x2E80)

    def handle_endtag(self, tag):
        if tag in {"script", "style"}:
            self.skip = False

    def handle_data(self, data):
        if not self.skip:
            self.points.update(ord(c) for c in data if ord(c) >= 0x2E80)


root = Path(__file__).resolve().parent.parent
output = Path(sys.argv[1]).resolve()
sources = root / "lib" / "fonts"
destination = output / "fonts" / "reading"
destination.mkdir(parents=True, exist_ok=True)
points = set(range(0x3000, 0x3040)) | CJK_PUNCTUATION

for page in output.rglob("*.html"):
    parser = PageText()
    parser.feed(page.read_text(encoding="utf-8"))
    points.update(parser.points)

# Include labels produced by browser widgets, not just the initial HTML.
for script in (output / "js").rglob("*.js"):
    if "libs" not in script.parts:
        points.update(ord(c) for c in script.read_text(encoding="utf-8") if ord(c) >= 0x2E80)

for filename in ("plus-jakarta-sans-latin.woff2", "newsreader-latin.woff2"):
    shutil.copyfile(sources / filename, destination / filename)
for license_file in sources.glob("OFL-*.txt"):
    shutil.copyfile(license_file, destination / license_file.name)

for kind in ("sans", "serif"):
    font = TTFont(sources / f"source-han-{kind}-cn-vf.otf.woff2")
    needed = points.intersection(font.getBestCmap())
    uncovered = sorted(p for p in points - needed if 0x3400 <= p <= 0x9FFF or 0x20000 <= p <= 0x2FA1F)
    if uncovered:
        print(f"Reading font: {kind}, {len(uncovered)} Han characters use system fallback: U+{', U+'.join(f'{p:04X}' for p in uncovered[:20])}")
    options = subset.Options()
    options.name_IDs = ["*"]
    options.name_languages = ["*"]
    options.layout_features.append("tnum")
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=needed)
    subsetter.subset(font)

    # Adobe's OFL reserves "Source". Give these generated subsets their own names.
    family = f"Aden Han {kind.title()}"
    postscript = family.replace(" ", "")
    for record in font["name"].names:
        if record.nameID in {1, 4, 16, 21}:
            value = family
        elif record.nameID == 6:
            value = postscript
        elif record.nameID == 3:
            value = f"{postscript}-BlogSubset"
        elif record.nameID > 255:
            value = record.toUnicode().replace("Source", "Aden")
        else:
            continue
        record.string = value.encode(record.getEncoding())

    font.flavor = "woff2"
    target = destination / f"aden-han-{kind}.woff2"
    font.save(target)
    print(f"Reading font: {kind}, {len(needed)} characters, {target.stat().st_size / 1024:.0f} KiB")
