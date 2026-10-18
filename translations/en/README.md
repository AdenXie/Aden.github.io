# Authored English post template

Copy this file as the same basename as its Chinese source post, then replace the fields and body. `source_hash` is the SHA-256 of the entire Chinese Markdown file after normalizing line endings to LF. On PowerShell:

```powershell
$p = 'source/_posts/<source filename>.md'
$s = [IO.File]::ReadAllText($p) -replace "`r`n?", "`n"
[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($s))).ToLowerInvariant()
```

The English copy becomes the source for the English article, card title and summary, search index, and latest-post feed. If the Chinese file changes, update the English copy and its hash after review.


Add <!--more--> after the opening paragraph when that paragraph should appear as the card summary. If omitted, the build uses the front matter description. The excerpt is protected from machine translation, including any quoted Chinese text.
