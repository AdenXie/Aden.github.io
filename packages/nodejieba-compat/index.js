"use strict";

// Redefine 2.9 expects nodejieba.cut(), but nodejieba's installer currently
// pulls a vulnerable archive dependency. This tiny compatibility package keeps
// the same method while using the maintained prebuilt @node-rs/jieba engine.
const { Jieba } = require("@node-rs/jieba");
const { dict } = require("@node-rs/jieba/dict");

const jieba = Jieba.withDict(dict);

module.exports = {
  cut(text, hmm = true) {
    return jieba.cut(String(text), Boolean(hmm));
  }
};
