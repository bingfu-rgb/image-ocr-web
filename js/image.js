(function () {
  const MAX_SIDE = 2200;
  const QUALITY = 0.88;
  const THUMB_SIDE = 160;
  const ENHANCE_MIN_SIDE = 1600;

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

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      const img = new Image();
      img.onload = function () {
        resolve(img);
      };
      img.onerror = function () {
        reject(new Error("图片加载失败"));
      };
      img.src = src;
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

  function otsuThreshold(gray) {
    const hist = new Array(256).fill(0);
    for (let i = 0; i < gray.length; i += 1) {
      hist[gray[i]] += 1;
    }
    const total = gray.length;
    let sum = 0;
    for (let t = 0; t < 256; t += 1) {
      sum += t * hist[t];
    }
    let sumB = 0;
    let weightB = 0;
    let best = 0;
    let threshold = 128;
    for (let t = 0; t < 256; t += 1) {
      weightB += hist[t];
      if (!weightB) continue;
      const weightF = total - weightB;
      if (!weightF) break;
      sumB += t * hist[t];
      const meanB = sumB / weightB;
      const meanF = (sum - sumB) / weightF;
      const between = weightB * weightF * (meanB - meanF) * (meanB - meanF);
      if (between > best) {
        best = between;
        threshold = t;
      }
    }
    return threshold;
  }

  async function enhanceForOcr(dataUrl) {
    const img = await loadImage(dataUrl);
    const maxSide = Math.max(img.width, img.height);
    const scale = maxSide < ENHANCE_MIN_SIDE ? Math.min(2, ENHANCE_MIN_SIDE / maxSide) : 1;
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, w, h);

    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;
    const gray = new Uint8Array(w * h);
    for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
      gray[p] = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
    }

    const threshold = otsuThreshold(gray);
    for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
      const value = gray[p] > threshold ? 255 : 0;
      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
      data[i + 3] = 255;
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL("image/png");
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
    enhanceForOcr: enhanceForOcr,
    frameFromVideo: frameFromVideo
  };
})();