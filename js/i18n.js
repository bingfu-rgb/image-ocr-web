(function () {
  const LANGUAGES = [
    { id: "chi_sim+eng", label: "中文简体 + 英文", prompt: "简体中文与英文" },
    { id: "chi_tra+eng", label: "中文繁体 + 英文", prompt: "繁体中文与英文" },
    { id: "eng", label: "英文", prompt: "英文" },
    { id: "jpn+eng", label: "日文 + 英文", prompt: "日文与英文" },
    { id: "kor+eng", label: "韩文 + 英文", prompt: "韩文与英文" }
  ];

  function get(id) {
    return LANGUAGES.find(function (item) {
      return item.id === id;
    }) || LANGUAGES[0];
  }

  window.OCRLangs = {
    list: LANGUAGES,
    get: get
  };
})();