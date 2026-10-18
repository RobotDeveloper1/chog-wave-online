// Injected before any page script: force preserveDrawingBuffer on every WebGL context so the page
// can read its own frames back with drawImage. Only used by the debugging harness.
(() => {
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, opts) {
    if (type === 'webgl2' || type === 'webgl' || type === 'experimental-webgl') {
      return orig.call(this, type, Object.assign({}, opts || {}, { preserveDrawingBuffer: true }));
    }
    return orig.call(this, type, opts);
  };
})();
