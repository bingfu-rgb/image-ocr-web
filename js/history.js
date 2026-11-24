(function () {
  const KEY = "imgocr.history.v1";
  const LIMIT = 20;

  function read() {
    try {
      const raw = localStorage.getItem(KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (err) {
      return [];
    }
  }

  function write(list) {
    try {
      localStorage.setItem(KEY, JSON.stringify(list));
      return true;
    } catch (err) {
      return false;
    }
  }

  function add(record) {
    const list = read();
    const item = {
      id: "h" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      time: Date.now(),
      name: record.name || "",
      thumb: record.thumb || "",
      text: record.text || "",
      tables: Array.isArray(record.tables) ? record.tables : [],
      mode: record.mode || "local",
      lang: record.lang || ""
    };
    list.unshift(item);
    while (list.length > LIMIT) {
      list.pop();
    }
    let ok = write(list);
    while (!ok && list.length) {
      list.pop();
      ok = write(list);
    }
    return item;
  }

  function list() {
    return read();
  }

  function remove(id) {
    const next = read().filter(function (item) {
      return item.id !== id;
    });
    write(next);
    return next;
  }

  function clear() {
    try {
      localStorage.removeItem(KEY);
    } catch (err) {}
  }

  window.OCRHistory = {
    add: add,
    list: list,
    remove: remove,
    clear: clear,
    LIMIT: LIMIT
  };
})();