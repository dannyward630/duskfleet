import { test } from "node:test";
import assert from "node:assert/strict";
import { slugify } from "../src/slugify.js";

test("joins words with dashes", () => {
  assert.equal(slugify("Hello World"), "hello-world");
});

test("strips punctuation and accents", () => {
  assert.equal(slugify("Ciao, Mondo!"), "ciao-mondo");
  assert.equal(slugify("Caffè & Brioche"), "caffe-brioche");
});

test("trims leading and trailing dashes", () => {
  assert.equal(slugify("  Hello  World  "), "hello-world");
});
