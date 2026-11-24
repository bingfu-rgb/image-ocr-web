(function () {
  const MAX_SIDE = 1800;
  const QUALITY = 0.85;
  const THUMB_SIDE = 160;

  function loadBitmap(file) {
    if (typeof createImageBitmap === "function") {
      return createImageBitmap(file, { imageOrientation: "from-image" }).catch(function () {
        return loadWithImageTag(file);
      });
    }
    return loadWithImageTag(file);
  }

  function loadWithImageTag(file) {
    return new Promise(function (resolve, reject) {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("无法读取这张图片"));
      };
      img.src = url;
    });
  }

  function drawScaled(source, maxSide) {
    const sw = source.width || source.naturalWidth;
    const sh = source.height || source.naturalHeight;
    const scale = Math.min(1, maxSide / Math.max(sw, sh));
    const w = Math.max(1, Math.round(sw * scale));
    const h = Math.max(1, Math.round(sh * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, w, h);
    return { canvas: canvas, width: w, height: h };
  }

  async function prepare(file) {
    const bitmap = await loadBitmap(file);
    const main = drawScaled(bitmap, MAX_SIDE);
    const thumb = drawScaled(bitmap, THUMB_SIDE);
    if (typeof bitmap.close === "function") {
      bitmap.close();
    }
    return {
      dataUrl: main.canvas.toDataURL("image/jpeg", QUALITY),
      thumb: thumb.canvas.toDataURL("image/jpeg", 0.72),
      width: main.width,
      height: main.height,
      bytes: Math.round(file.size || 0)
    };
  }

  function frameFromVideo(video) {
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return new Promise(function (resolve) {
      canvas.toBlob(function (blob) {
        resolve(blob);
      }, "image/jpeg", 0.9);
    });
  }

  window.OCRImage = {
    prepare: prepare,
    frameFromVideo: frameFromVideo
  };
})();