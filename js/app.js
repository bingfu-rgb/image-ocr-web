(function () {
  const Config = window.OCRConfig;
  const Langs = window.OCRLangs;
  const Img = window.OCRImage;
  const Table = window.OCRTable;
  const Local = window.OCRLocal;
  const Cloud = window.OCRCloud;
  const History = window.OCRHistory;

  const STAGE_TEXT = {
    "loading tesseract core": "加载识别引擎",
    "initializing tesseract": "初始化引擎",
    "loading language traineddata": "下载语言包",
    "initializing api": "准备识别",
    "recognizing text": "识别中",
    done: "完成"
  };

  const state = {
    queue: [],
    activeId: null,
    view: null,
    busy: false,
    cameraStream: null
  };

  let settings = Config.load();
  const els = {};
  let toastTimer = null;

  function $(id) {
    return document.getElementById(id);
  }

  function init() {
    [
      "langSelect",
      "cloudBadge",
      "historyBtn",
      "settingsBtn",
      "dropzone",
      "pickBtn",
      "cameraBtn",
      "fileInput",
      "captureInput",
      "queueCount",
      "clearQueueBtn",
      "queueEmpty",
      "queueList",
      "resultBody",
      "resultMode",
      "copyBtn",
      "downloadMdBtn",
      "downloadTxtBtn",
      "downloadCsvBtn",
      "settingsDialog",
      "settingsForm",
      "cloudEnabled",
      "baseUrl",
      "apiKey",
      "modelInput",
      "toggleKeyBtn",
      "historyDialog",
      "historyBody",
      "clearHistoryBtn",
      "cameraDialog",
      "cameraVideo",
      "cameraCancel",
      "shutterBtn",
      "toast"
    ].forEach(function (id) {
      els[id] = $(id);
    });

    fillLanguages();
    bindEvents();
    renderCloudBadge();
    renderQueue();
    renderView();

    if (!window.Tesseract) {
      toast("识别引擎没能从 CDN 加载，请检查网络后刷新", "error");
    }

    window.addEventListener("beforeunload", function () {
      Local.dispose();
    });
  }

  function fillLanguages() {
    els.langSelect.innerHTML = "";
    Langs.list.forEach(function (lang) {
      const option = document.createElement("option");
      option.value = lang.id;
      option.textContent = lang.label;
      els.langSelect.appendChild(option);
    });
    els.langSelect.value = Langs.get(settings.lang).id;
  }

  function bindEvents() {
    els.langSelect.addEventListener("change", function () {
      settings = Config.save(Object.assign({}, settings, { lang: els.langSelect.value }));
      toast("识别语言： " + Langs.get(settings.lang).label);
    });

    els.pickBtn.addEventListener("click", function () {
      els.fileInput.value = "";
      els.fileInput.click();
    });

    els.cameraBtn.addEventListener("click", openCamera);
    els.fileInput.addEventListener("change", function () {
      addFiles(els.fileInput.files);
    });
    els.captureInput.addEventListener("change", function () {
      addFiles(els.captureInput.files);
    });

    ["dragenter", "dragover"].forEach(function (type) {
      els.dropzone.addEventListener(type, function (event) {
        event.preventDefault();
        els.dropzone.classList.add("drag");
      });
    });
    ["dragleave", "drop"].forEach(function (type) {
      els.dropzone.addEventListener(type, function (event) {
        event.preventDefault();
        els.dropzone.classList.remove("drag");
      });
    });
    els.dropzone.addEventListener("drop", function (event) {
      const files = event.dataTransfer && event.dataTransfer.files;
      if (files && files.length) addFiles(files);
    });
    window.addEventListener("dragover", function (event) {
      event.preventDefault();
    });
    window.addEventListener("drop", function (event) {
      event.preventDefault();
    });

    els.clearQueueBtn.addEventListener("click", clearQueue);
    els.queueList.addEventListener("click", onQueueClick);

    els.settingsBtn.addEventListener("click", openSettings);
    els.cloudBadge.addEventListener("click", openSettings);
    els.settingsForm.addEventListener("submit", saveSettings);
    els.toggleKeyBtn.addEventListener("click", toggleKeyVisibility);

    els.historyBtn.addEventListener("click", openHistory);
    els.historyBody.addEventListener("click", onHistoryClick);
    els.clearHistoryBtn.addEventListener("click", function () {
      History.clear();
      renderHistory();
      toast("历史记录已清空");
    });

    els.cameraCancel.addEventListener("click", closeCamera);
    els.shutterBtn.addEventListener("click", captureFromCamera);
    els.cameraDialog.addEventListener("close", stopCameraStream);

    els.copyBtn.addEventListener("click", copyCurrent);
    els.downloadMdBtn.addEventListener("click", downloadMarkdown);
    els.downloadTxtBtn.addEventListener("click", downloadTxt);
    els.downloadCsvBtn.addEventListener("click", downloadCsv);

    document.querySelectorAll("[data-close]").forEach(function (button) {
      button.addEventListener("click", function () {
        const dialog = button.closest("dialog");
        if (dialog) dialog.close();
      });
    });
  }

  async function addFiles(fileList) {
    const files = Array.prototype.slice.call(fileList || []).filter(function (file) {
      return file && file.type && file.type.indexOf("image/") === 0;
    });
    if (!files.length) {
      toast("请选择图片文件", "warn");
      return;
    }

    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      const item = {
        id: "q" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name: file.name || "拍照_" + stamp() + ".jpg",
        status: "pending",
        progress: 0,
        stage: "准备中",
        dataUrl: "",
        thumb: ""
      };
      state.queue.push(item);
      renderQueue();

      try {
        const packed = await Img.prepare(file);
        item.dataUrl = packed.dataUrl;
        item.thumb = packed.thumb;
      } catch (err) {
        item.status = "error";
        item.error = err.message || "图片读取失败";
      }
      renderQueue();
      processQueue();
    }
    processQueue();
  }

  async function processQueue() {
    if (state.busy) return;
    state.busy = true;
    try {
      while (true) {
        const item = state.queue.find(function (entry) {
          return entry.status === "pending" && entry.dataUrl;
        });
        if (!item) break;
        await runItem(item);
      }
    } finally {
      state.busy = false;
    }
  }

  async function runItem(item) {
    item.status = "running";
    item.progress = 0;
    item.stage = "识别中";
    if (!state.activeId) {
      state.activeId = item.id;
    }
    renderQueue();
    renderActiveResult();

    const language = Langs.get(settings.lang);
    const reporter = function (message) {
      item.progress = Math.max(0, Math.min(1, Number(message && message.progress) || 0));
      item.stage = STAGE_TEXT[message && message.status] || "识别中";
      const node = els.queueList.querySelector('[data-id="' + item.id + '"]');
      if (!node) return;
      const statusNode = node.querySelector(".q-status");
      if (statusNode) {
        statusNode.textContent = item.stage + " " + Math.round(item.progress * 100) + "%";
      }
      const barNode = node.querySelector(".q-bar > span");
      if (barNode) {
        barNode.style.width = Math.round(item.progress * 100) + "%";
      }
    };

    let result = null;
    let cloudError = "";

    if (Config.isCloudConfigured(settings)) {
      try {
        result = await Cloud.recognize(item.dataUrl, settings, language, reporter);
      } catch (err) {
        cloudError = err.message || "云端识别失败";
      }
    }

    if (!result) {
      try {
        result = await Local.recognize(item.dataUrl, language, reporter);
        if (cloudError) {
          result.note = "云端失败，已改用本地识别";
        }
      } catch (err) {
        item.status = "error";
        item.error = err.message || "识别失败";
        renderQueue();
        if (state.activeId === item.id) {
          showResult({ error: item.error, mode: "local", name: item.name });
        }
        if (cloudError) {
          toast(cloudError, "error");
        }
        return;
      }
    }

    if (item.cancelled) return;

    item.result = result;
    item.status = "done";
    item.progress = 1;
    renderQueue();

    History.add({
      name: item.name,
      thumb: item.thumb,
      text: result.text,
      tables: result.tables,
      mode: result.mode,
      lang: settings.lang
    });

    if (state.activeId === item.id) {
      showResult(result, item.name);
    }

    if (cloudError) {
      toast(cloudError + "，已改用本地识别", "warn");
    }
  }

  function renderQueue() {
    els.queueCount.textContent = String(state.queue.length);
    els.queueEmpty.hidden = state.queue.length > 0;

    if (state.activeId && !state.queue.some(function (item) {
      return item.id === state.activeId;
    })) {
      state.activeId = null;
    }

    els.queueList.innerHTML = "";

    state.queue.forEach(function (item) {
      const row = document.createElement("li");
      row.className = "queue-item" + (item.id === state.activeId ? " active" : "");
      row.dataset.id = item.id;

      const thumb = document.createElement("img");
      thumb.className = "q-thumb";
      thumb.alt = "";
      if (item.thumb) thumb.src = item.thumb;

      const main = document.createElement("div");
      main.className = "q-main";

      const name = document.createElement("div");
      name.className = "q-name";
      name.textContent = item.name;

      const status = document.createElement("div");
      status.className = "q-status";
      if (item.status === "done") {
        status.textContent = modeLabel(item.result && item.result.mode) + " · 已完成";
        status.classList.add("done");
      } else if (item.status === "error") {
        status.textContent = item.error || "识别失败";
        status.classList.add("error");
      } else if (item.status === "running") {
        status.textContent = (item.stage || "识别中") + " " + Math.round(item.progress * 100) + "%";
      } else {
        status.textContent = "等待识别";
      }

      const bar = document.createElement("div");
      bar.className = "q-bar";
      const fill = document.createElement("span");
      fill.style.width = (item.status === "done" ? 100 : Math.round(item.progress * 100)) + "%";
      bar.appendChild(fill);

      main.appendChild(name);
      main.appendChild(status);
      main.appendChild(bar);

      const remove = document.createElement("button");
      remove.className = "q-del";
      remove.type = "button";
      remove.textContent = "✕";
      remove.dataset.del = item.id;
      remove.title = "移除";

      row.appendChild(thumb);
      row.appendChild(main);
      row.appendChild(remove);
      els.queueList.appendChild(row);
    });
  }

  function renderActiveResult() {
    const item = state.queue.find(function (entry) {
      return entry.id === state.activeId;
    });
    if (!item) return;
    if (item.status === "done" && item.result) {
      showResult(item.result, item.name);
    } else if (item.status === "error") {
      showResult({ error: item.error, mode: "local", name: item.name });
    } else {
      state.view = { pending: true, name: item.name };
      renderView();
    }
  }

  function onQueueClick(event) {
    const removeBtn = event.target.closest("[data-del]");
    if (removeBtn) {
      event.stopPropagation();
      removeItem(removeBtn.dataset.del);
      return;
    }
    const row = event.target.closest(".queue-item");
    if (!row) return;
    selectItem(row.dataset.id);
  }

  function selectItem(id) {
    const item = state.queue.find(function (entry) {
      return entry.id === id;
    });
    if (!item) return;
    state.activeId = id;
    renderQueue();
    renderActiveResult();
  }

  function removeItem(id) {
    const index = state.queue.findIndex(function (entry) {
      return entry.id === id;
    });
    if (index === -1) return;
    state.queue[index].cancelled = true;
    state.queue.splice(index, 1);
    if (state.activeId === id) {
      state.activeId = null;
      state.view = null;
      const next = state.queue.find(function (entry) {
        return entry.status === "done";
      });
      if (next) {
        state.activeId = next.id;
        showResult(next.result, next.name);
      } else {
        renderView();
      }
    }
    renderQueue();
  }

  function clearQueue() {
    if (state.busy) {
      toast("还有图片正在识别，请稍候", "warn");
      return;
    }
    state.queue = [];
    state.activeId = null;
    state.view = null;
    renderQueue();
    renderView();
  }

  function showResult(result, name) {
    state.view = {
      text: result.text || "",
      tables: Array.isArray(result.tables) ? result.tables : [],
      mode: result.mode || "local",
      name: name || "",
      note: result.note || "",
      error: result.error || ""
    };
    renderView();
  }

  function renderView() {
    const view = state.view;
    els.resultBody.innerHTML = "";

    if (!view) {
      els.resultMode.textContent = "";
      els.resultBody.appendChild(emptyNode("识别结果会显示在这里。"));
      setToolsEnabled(false);
      return;
    }

    if (view.error) {
      els.resultMode.textContent = "";
      els.resultBody.appendChild(emptyNode(view.error));
      setToolsEnabled(false);
      return;
    }

    if (view.pending) {
      els.resultMode.textContent = "等待中";
      els.resultBody.appendChild(emptyNode("正在识别，请稍候…"));
      setToolsEnabled(false);
      return;
    }

    const hasText = Boolean(view.text && view.text.trim());
    const hasTables = view.tables.length > 0;
    setToolsEnabled(hasText || hasTables);

    els.resultMode.textContent = modeLabel(view.mode);

    const meta = document.createElement("div");
    meta.className = "result-meta";
    const pieces = [];
    if (view.name) pieces.push(view.name);
    pieces.push(modeLabel(view.mode));
    if (view.note) pieces.push(view.note);
    meta.textContent = pieces.join(" · ");
    els.resultBody.appendChild(meta);

    if (hasText) {
      const text = document.createElement("div");
      text.className = "result-text";
      text.textContent = view.text;
      els.resultBody.appendChild(text);
    }

    view.tables.forEach(function (markdown, index) {
      const rows = Table.parseMarkdown(markdown);
      if (!rows.length) return;
      const section = document.createElement("section");
      section.className = "result-table";
      const title = document.createElement("h3");
      title.textContent = "表格 " + (index + 1);
      const wrap = document.createElement("div");
      wrap.className = "table-scroll";
      wrap.appendChild(buildTable(rows));
      section.appendChild(title);
      section.appendChild(wrap);
      els.resultBody.appendChild(section);
    });

    if (!hasText && !hasTables) {
      els.resultBody.appendChild(emptyNode("没有识别到文字。可以换一张更清晰的图片，或切换识别语言再试。"));
    }

    els.resultBody.scrollTop = 0;
  }

  function setToolsEnabled(enabled) {
    els.copyBtn.disabled = !enabled;
    els.downloadMdBtn.disabled = !enabled;
    els.downloadTxtBtn.disabled = !enabled;
    els.downloadCsvBtn.disabled = !enabled || !(state.view && state.view.tables.length);
  }

  function buildTable(rows) {
    const width = Math.max.apply(
      null,
      rows.map(function (row) {
        return row.length;
      })
    );
    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    for (let i = 0; i < width; i += 1) {
      const th = document.createElement("th");
      th.textContent = (rows[0] && rows[0][i]) || "";
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    rows.slice(1).forEach(function (row) {
      const tr = document.createElement("tr");
      for (let i = 0; i < width; i += 1) {
        const td = document.createElement("td");
        td.textContent = row[i] || "";
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    return table;
  }

  function currentContent() {
    if (!state.view) return "";
    const parts = [];
    if (state.view.text && state.view.text.trim()) parts.push(state.view.text.trim());
    state.view.tables.forEach(function (markdown) {
      parts.push(markdown);
    });
    return parts.join("\n\n");
  }

  async function copyCurrent() {
    const content = currentContent();
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      toast("已复制到剪贴板");
    } catch (err) {
      fallbackCopy(content);
    }
  }

  function fallbackCopy(content) {
    const area = document.createElement("textarea");
    area.value = content;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch (err) {}
    area.remove();
    toast(ok ? "已复制到剪贴板" : "复制失败，请手动选择文本", ok ? undefined : "warn");
  }

  function downloadMarkdown() {
    if (!state.view) return;
    const parts = [];
    if (state.view.text && state.view.text.trim()) parts.push(state.view.text.trim());
    state.view.tables.forEach(function (markdown) {
      parts.push(markdown);
    });
    download(fileBaseName() + ".md", "text/markdown", "# 识别结果\n\n" + parts.join("\n\n"));
  }

  function downloadTxt() {
    const content = currentContent();
    if (!content) return;
    download(fileBaseName() + ".txt", "text/plain", content);
  }

  function downloadCsv() {
    if (!state.view || !state.view.tables.length) return;
    const blocks = state.view.tables
      .map(function (markdown) {
        return Table.toCsv(Table.parseMarkdown(markdown));
      })
      .filter(Boolean);
    if (!blocks.length) return;
    download(fileBaseName() + ".csv", "text/csv", blocks.join("\n\n"));
  }

  function download(filename, mime, content) {
    const blob = new Blob([content], { type: mime + ";charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  function fileBaseName() {
    const name = (state.view && state.view.name) || "识别结果";
    return name.replace(/\.[^.]+$/, "") + "-" + stamp();
  }

  function openSettings() {
    els.cloudEnabled.checked = Boolean(settings.cloudEnabled);
    els.baseUrl.value = settings.baseUrl || Config.DEFAULTS.baseUrl;
    els.apiKey.value = settings.apiKey || "";
    els.modelInput.value = settings.model || "";
    els.apiKey.type = "password";
    els.toggleKeyBtn.textContent = "显示";
    if (!els.settingsDialog.open) els.settingsDialog.showModal();
  }

  function saveSettings(event) {
    event.preventDefault();
    settings = Config.save({
      lang: settings.lang,
      cloudEnabled: els.cloudEnabled.checked,
      baseUrl: els.baseUrl.value.trim(),
      apiKey: els.apiKey.value.trim(),
      model: els.modelInput.value.trim()
    });
    renderCloudBadge();
    els.settingsDialog.close();
    if (settings.cloudEnabled && !Config.isCloudConfigured(settings)) {
      toast("云端增强已开启，但地址、Key 或模型还没填完整", "warn");
    } else {
      toast("设置已保存");
    }
  }

  function toggleKeyVisibility() {
    const showing = els.apiKey.type === "text";
    els.apiKey.type = showing ? "password" : "text";
    els.toggleKeyBtn.textContent = showing ? "显示" : "隐藏";
  }

  function renderCloudBadge() {
    const enabled = Config.isCloudConfigured(settings);
    els.cloudBadge.textContent = enabled ? "云端增强" : "本地识别";
    els.cloudBadge.classList.toggle("on", enabled);
    els.cloudBadge.title = enabled ? "点击修改云端设置" : "当前使用浏览器本地识别，点击可配置云端增强";
  }

  async function openCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      els.captureInput.value = "";
      els.captureInput.click();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false
      });
      state.cameraStream = stream;
      els.cameraVideo.srcObject = stream;
      els.cameraDialog.showModal();
    } catch (err) {
      toast("无法打开摄像头，改用系统拍照", "warn");
      els.captureInput.value = "";
      els.captureInput.click();
    }
  }

  async function captureFromCamera() {
    const video = els.cameraVideo;
    if (!video.videoWidth) {
      toast("摄像头还没准备好，请稍等", "warn");
      return;
    }
    const blob = await Img.frameFromVideo(video);
    closeCamera();
    if (blob) addFiles([blob]);
  }

  function closeCamera() {
    stopCameraStream();
    if (els.cameraDialog.open) els.cameraDialog.close();
  }

  function stopCameraStream() {
    if (state.cameraStream) {
      state.cameraStream.getTracks().forEach(function (track) {
        track.stop();
      });
      state.cameraStream = null;
    }
    els.cameraVideo.srcObject = null;
  }

  function openHistory() {
    renderHistory();
    if (!els.historyDialog.open) els.historyDialog.showModal();
  }

  function renderHistory() {
    const items = History.list();
    els.historyBody.innerHTML = "";
    if (!items.length) {
      els.historyBody.appendChild(emptyNode("还没有历史记录。"));
      return;
    }
    items.forEach(function (record) {
      const row = document.createElement("div");
      row.className = "history-item";
      row.dataset.history = record.id;

      const thumb = document.createElement("img");
      thumb.alt = "";
      if (record.thumb) thumb.src = record.thumb;

      const main = document.createElement("div");
      main.className = "history-main";

      const time = document.createElement("div");
      time.className = "h-time";
      const timeParts = [formatDateTime(record.time), modeLabel(record.mode)];
      if (record.lang) timeParts.push(Langs.get(record.lang).label);
      time.textContent = timeParts.join(" · ");

      const snippet = document.createElement("div");
      snippet.className = "h-snippet";
      const mark = record.tables && record.tables.length ? "［含表格］" : "";
      snippet.textContent =
        mark + (record.text || "").replace(/\s+/g, " ").slice(0, 120) || "（无文字）";

      main.appendChild(time);
      main.appendChild(snippet);

      const remove = document.createElement("button");
      remove.className = "history-del";
      remove.type = "button";
      remove.textContent = "✕";
      remove.dataset.historyDel = record.id;
      remove.title = "删除这条";

      row.appendChild(thumb);
      row.appendChild(main);
      row.appendChild(remove);
      els.historyBody.appendChild(row);
    });
  }

  function onHistoryClick(event) {
    const removeBtn = event.target.closest("[data-history-del]");
    if (removeBtn) {
      History.remove(removeBtn.dataset.historyDel);
      renderHistory();
      return;
    }
    const row = event.target.closest("[data-history]");
    if (!row) return;
    const record = History.list().find(function (item) {
      return item.id === row.dataset.history;
    });
    if (!record) return;
    state.activeId = null;
    renderQueue();
    state.view = {
      text: record.text || "",
      tables: record.tables || [],
      mode: record.mode || "local",
      name: record.name || formatDateTime(record.time),
      note: "来自历史记录",
      error: ""
    };
    renderView();
    els.historyDialog.close();
    toast("已载入历史记录");
  }

  function emptyNode(message) {
    const node = document.createElement("p");
    node.className = "empty";
    node.textContent = message;
    return node;
  }

  function modeLabel(mode) {
    if (mode === "cloud") return "云端增强";
    if (mode === "local") return "本地识别";
    return "";
  }

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function stamp() {
    const now = new Date();
    return (
      now.getFullYear() +
      pad(now.getMonth() + 1) +
      pad(now.getDate()) +
      "-" +
      pad(now.getHours()) +
      pad(now.getMinutes())
    );
  }

  function formatDateTime(time) {
    const date = new Date(time);
    if (isNaN(date.getTime())) return "";
    return (
      date.getFullYear() +
      "-" +
      pad(date.getMonth() + 1) +
      "-" +
      pad(date.getDate()) +
      " " +
      pad(date.getHours()) +
      ":" +
      pad(date.getMinutes())
    );
  }

  function toast(message, kind) {
    els.toast.textContent = message;
    els.toast.className = "toast" + (kind ? " " + kind : "");
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      els.toast.hidden = true;
    }, 3800);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();