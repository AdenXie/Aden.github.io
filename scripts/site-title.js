hexo.extend.filter.register("after_render:html", (html) =>
  html.replace(
    /<title>\s*Aden(?:'|&#39;)s Space\s*-\s*Redefine Your Hexo Journey\.\s*<\/title>/,
    "<title>Aden's Space</title>",
  ),
);
