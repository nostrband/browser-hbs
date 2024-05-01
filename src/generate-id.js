// copyright: https://raw.githubusercontent.com/TryGhost/express-hbs/main/lib/generate-id.js

"use strict";

var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_";

export default function generateId(length) {
  if (!length) {
    length = 8;
  }
  var res = "";
  for (var i = 0; i < length; ++i) {
    res += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return res;
}
