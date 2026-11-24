(function () {
  function buildPrompt(lang) {
    const languageName = (lang && lang.prompt) || "简体中文";
    return [
      "你是 OCR 识别助手。请从图片中提取全部可见文字，并还原表格结构。",
      "严格只输出一个 JSON 对象，不要输出解释，不要用代码块包裹整个 JSON。",
      '格式：{"text":"非表格文字，保留段落换行","tables":["| 列1 | 列2 |\\n| --- | --- |\\n| a | b |"]}',
      "规则：",
      "1. 表格必须使用 GitHub 风格 Markdown 表格，保留行列关系，合并单元格用重复值填充。",
      "2. 非表格内容放进 text，尽量保持原始顺序和换行。",
      "3. 没有表格时 tables 为空数组；没有文字时 text 为空字符串。",
      "4. 无法辨认的内容用 [?] 标注，不要编造。",
      "5. 文字语言：" + languageName + "。"
    ].join("\n");
  }

  function stripFence(content) {
    const text = String(content || "").trim();
    const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    return match ? match[1].trim() : text;
  }

  function splitTables(content) {
    const text = String(content || "");
    const pattern = /(?:^\|.*\|[ \t]*$\n?){1,}/gm;
    const blocks = text.match(pattern) || [];
    const rest = text.replace(pattern, "").trim();
    return {
      text: rest,
      tables: blocks
        .map(function (block) {
          return block.trim();
        })
        .filter(Boolean)
    };
  }

  function parseContent(content) {
    const cleaned = stripFence(content);
    if (!cleaned) return { text: "", tables: [] };
    try {
      const parsed = JSON.parse(cleaned);
      if (parsed && typeof parsed === "object") {
        const text = typeof parsed.text === "string" ? parsed.text : "";
        const tables = Array.isArray(parsed.tables)
          ? parsed.tables.filter(function (item) {
              return typeof item === "string" && item.trim();
            })
          : [];
        return { text: text.trim(), tables: tables };
      }
    } catch (err) {}
    return splitTables(cleaned);
  }

  function extractContent(message) {
    if (!message) return "";
    const content = message.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map(function (part) {
          if (typeof part === "string") return part;
          return part && typeof part.text === "string" ? part.text : "";
        })
        .join("");
    }
    return "";
  }

  function isConfigured(settings) {
    return Boolean(settings && settings.baseUrl && settings.apiKey && settings.model);
  }

  async function recognize(dataUrl, settings, lang, onProgress) {
    if (!isConfigured(settings)) {
      throw new Error("云端识别参数不完整");
    }
    const endpoint = String(settings.baseUrl).replace(/\/+$/, "") + "/chat/completions";
    const body = {
      model: settings.model,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: buildPrompt(lang) },
            { type: "image_url", image_url: { url: dataUrl } }
          ]
        }
      ]
    };

    if (onProgress) onProgress({ status: "cloud", progress: 0.25 });

    let response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + settings.apiKey
        },
        body: JSON.stringify(body)
      });
    } catch (err) {
      throw new Error("无法连接接口，可能是跨域被拦截，请改用支持跨域的服务或自建代理");
    }

    if (!response.ok) {
      let detail = "";
      try {
        detail = (await response.text()).slice(0, 180);
      } catch (err) {}
      throw new Error("接口返回 " + response.status + (detail ? "：" + detail : ""));
    }

    let payload;
    try {
      payload = await response.json();
    } catch (err) {
      throw new Error("接口返回内容不是合法 JSON");
    }

    const message =
      payload && payload.choices && payload.choices[0] ? payload.choices[0].message : null;
    const content = extractContent(message);
    if (!content.trim()) {
      throw new Error("接口没有返回识别内容");
    }

    if (onProgress) onProgress({ status: "done", progress: 1 });

    const parsed = parseContent(content);
    return { text: parsed.text, tables: parsed.tables, mode: "cloud" };
  }

  window.OCRCloud = {
    recognize: recognize,
    isConfigured: isConfigured,
    parseContent: parseContent
  };
})();