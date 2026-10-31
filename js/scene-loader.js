/* 3D scenes: Saturn behind the home banner, the "404 Mart" on the not-found page.
   Loaded after first paint on devices with WebGL2 and enough memory, unless the
   visitor asks for reduced motion or data saving; those keep the static banner
   image and the blackwall 404. Touch devices and devices reporting under 4 GB get a
   lighter setup (Chrome rounds deviceMemory down, so many 4 GB phones report 2). */
(() => {
  'use strict';
  if (!window.AdenSite || window.AdenScenes) return;
  let webgl2;
  const memory = navigator.deviceMemory ?? 8;
  const capable = () => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || navigator.connection?.saveData) return false;
    if (memory < 2) return false;
    if (webgl2 === undefined) {
      const gl = document.createElement('canvas').getContext('webgl2');
      webgl2 = Boolean(gl);
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    }
    return webgl2;
  };
  function scene(name, selector, module) {
    window.AdenSite.register(name, selector, (root, scope) => {
      if (!capable()) return;
      let dispose = null;
      scope.afterPaint(() => {
        import(module)
          .then(m => {
            if (scope.signal.aborted) return;
            const lite = matchMedia('(pointer: coarse)').matches || memory < 4;
            dispose = m.mount(root, lite ? { maxDpr: 1.25, lite: true } : {});
          })
          .catch(() => {});
      });
      return () => dispose?.();
    });
  }
  window.AdenScenes = true;
  scene('saturn', '.home-banner-container', '/js/scenes/saturn.js');
  scene('store', '.nf-container', '/js/scenes/store.js');
})();
