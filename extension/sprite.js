(function (root) {
  'use strict';
  // Measured alpha bounds of the unmodified, generated transparent atlas.
  const rects = [
    [42,10,301,364], [403,72,327,302], [767,12,301,362], [1129,7,303,367],
    [32,380,329,345], [403,380,304,349], [766,377,292,352], [1134,374,298,355],
    [52,730,314,344], [402,732,307,345], [762,730,313,329], [1153,734,225,343]
  ];
  function paint(element, index, size = 180) {
    const [x, y, w, h] = rects[index] || rects[0];
    const scale = size / 380;
    Object.assign(element.style, {
      width: `${w * scale}px`, height: `${h * scale}px`,
      left: `${(size - w * scale) / 2}px`, bottom: `${size * .025}px`,
      backgroundSize: `${1448 * scale}px ${1086 * scale}px`,
      backgroundPosition: `${-x * scale}px ${-y * scale}px`
    });
    element.dataset.poseIndex = String(index);
  }
  root.WhaleSprite = { rects, paint };
})(globalThis);
