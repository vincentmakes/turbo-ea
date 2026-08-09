// See package.json for why this stub exists. pptxgenjs's browser build never
// imports image-size (its `browser` field maps it to false), so this code is
// unreachable in Turbo EA; throwing keeps any future Node-side use loud.
module.exports = function imageSizeStub() {
  throw new Error(
    "image-size is stubbed out in Turbo EA (browser-only build; see frontend/stubs/image-size)"
  );
};
