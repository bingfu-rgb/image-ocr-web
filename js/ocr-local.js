(function () {
  let workerPromise = null;
  let workerLang = null;
  let progressHandler = null;

  function langId(lang) {
    if (typeof lang === "string") return lang;
    return (lang && lang.id) || "eng";
  }

  function ensureWorker(lang, onProgress) {
    const code = langId(lang);
    progressHandler = onProgress;
    if (workerPromise && workerLang === code) {
      return workerPromise;
    }
    if (!window.Tesseract) {
      return Promise.reject(new Error("识别引擎加载失败，请检查网络后刷新页面"));
    }
    if (workerPromise) {
      const previous = workerPromise;
      previous
        .then(function (worker) {
          return worker.terminate();
        })
        .catch(function () {});
    }
    workerLang = code;
    workerPromise = window.Tesseract.createWorker(code, 1, {
      logger: function (message) {
        if (progressHandler) progressHandler(message);
      }
    })
      .then(async function (worker) {
        try {
          await worker.setParameters({
            tessedit_pageseg_mode: "3",
            preserve_interword_spaces: "1",
            user_defined_dpi: "300"
          });
        } catch (err) {}
        return worker;
      })
      .catch(function (err) {
        workerPromise = null;
        workerLang = null;
        throw err;
      });
    return workerPromise;
  }

  function tidyText(text) {
    return String(text || "")
      .replace(/([\u3400-\u9fff])[ \t]+(?=[\u3400-\u9fff])/g, "$1")
      .replace(/([，。、；：？！])[ \t]+/g, "$1")
      .replace(/[ \t]+([，。、；：？！])/g, "$1")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function stripTableLines(text, rows) {
    if (!rows || !rows.length) return text;
    const keys = rows
      .map(function (row) {
        return row.join("").replace(/\s/g, "");
      })
      .filter(function (key) {
        return key.length >= 2;
      });
    if (!keys.length) return text;
    const kept = text.split("\n").filter(function (line) {
      const compact = line.replace(/\s/g, "");
      if (!compact) return true;
      return !keys.some(function (key) {
        return compact === key || (key.length >= 4 && compact.indexOf(key) !== -1);
      });
    });
    return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  async function prepareSource(dataUrl, enhance, onProgress) {
    if (!enhance) return dataUrl;
    if (onProgress) {
      onProgress({ status: "enhancing image", progress: 0 });
    }
    try {
      return await window.OCRImage.enhanceForOcr(dataUrl);
    } catch (err) {
      return dataUrl;
    }
  }

  async function recognize(dataUrl, lang, onProgress, options) {
    const enhance = !options || options.enhance !== false;
    const source = await prepareSource(dataUrl, enhance, onProgress);
    const worker = await ensureWorker(lang, onProgress);
    if (onProgress) {
      onProgress({ status: "recognizing text", progress: 0 });
    }
    const response = await worker.recognize(source);
    const data = (response && response.data) || {};
    const text = tidyText(data.text);
    const tables = [];
    let bodyText = text;
    try {
      const rows = window.OCRTable.fromTesseract(data);
      if (rows && rows.length) {
        tables.push(window.OCRTable.toMarkdown(rows));
        bodyText = stripTableLines(text, rows);
      }
    } catch (err) {}
    if (onProgress) {
      onProgress({ status: "done", progress: 1 });
    }
    return { text: bodyText, tables: tables, mode: "local" };
  }

  async function dispose() {
    if (!workerPromise) return;
    try {
      const worker = await workerPromise;
      await worker.terminate();
    } catch (err) {}
    workerPromise = null;
    workerLang = null;
  }

  window.OCRLocal = {
    recognize: recognize,
    dispose: dispose
  };
})();