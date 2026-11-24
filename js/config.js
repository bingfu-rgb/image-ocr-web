(function () {
  const KEY = "imgocr.settings.v1";

  const DEFAULTS = {
    lang: "chi_sim+eng",
    enhance: true,
    cloudEnabled: false,
    baseUrl: "https://openrouter.ai/api/v1",
    apiKey: "",
    model: ""
  };

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      const saved = raw ? JSON.parse(raw) : {};
      return Object.assign({}, DEFAULTS, saved || {});
    } catch (err) {
      return Object.assign({}, DEFAULTS);
    }
  }

  function save(settings) {
    const next = Object.assign({}, DEFAULTS, settings || {});
    localStorage.setItem(KEY, JSON.stringify(next));
    return next;
  }

  function isCloudConfigured(settings) {
    const s = settings || load();
    return Boolean(s.cloudEnabled && s.baseUrl && s.apiKey && s.model);
  }

  window.OCRConfig = {
    KEY: KEY,
    DEFAULTS: DEFAULTS,
    load: load,
    save: save,
    isCloudConfigured: isCloudConfigured
  };
})();