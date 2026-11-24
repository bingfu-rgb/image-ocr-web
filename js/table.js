(function () {
  function median(values) {
    if (!values.length) return 0;
    const sorted = values.slice().sort(function (a, b) {
      return a - b;
    });
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function collectWords(data) {
    if (Array.isArray(data.words) && data.words.length) {
      return data.words;
    }
    const out = [];
    const blocks = Array.isArray(data.blocks) ? data.blocks : [];
    blocks.forEach(function (block) {
      (block.paragraphs || []).forEach(function (para) {
        (para.lines || []).forEach(function (line) {
          (line.words || []).forEach(function (word) {
            out.push(word);
          });
        });
      });
    });
    return out;
  }

  function normalizeWords(data) {
    const words = collectWords(data);
    const list = [];
    words.forEach(function (word) {
      const text = String(word.text || "").trim();
      if (!text || !word.bbox) return;
      const b = word.bbox;
      list.push({
        text: text,
        x0: b.x0,
        x1: b.x1,
        y0: b.y0,
        y1: b.y1,
        cx: (b.x0 + b.x1) / 2,
        cy: (b.y0 + b.y1) / 2,
        h: b.y1 - b.y0,
        w: b.x1 - b.x0
      });
    });
    return list;
  }

  function groupRows(words, tolerance) {
    const sorted = words.slice().sort(function (a, b) {
      return a.cy - b.cy || a.x0 - b.x0;
    });
    const rows = [];
    sorted.forEach(function (word) {
      const last = rows[rows.length - 1];
      if (last && Math.abs(word.cy - last.cy) <= tolerance) {
        last.words.push(word);
        last.cy = (last.cy * (last.words.length - 1) + word.cy) / last.words.length;
      } else {
        rows.push({ cy: word.cy, words: [word] });
      }
    });
    rows.forEach(function (row) {
      row.words.sort(function (a, b) {
        return a.x0 - b.x0;
      });
    });
    return rows;
  }

  function clusterColumns(rows, gapLimit) {
    const cells = [];
    rows.forEach(function (row) {
      row.cells = [];
      let current = null;
      row.words.forEach(function (word) {
        if (current && word.x0 - current.x1 <= gapLimit) {
          current.text += " " + word.text;
          current.x1 = Math.max(current.x1, word.x1);
        } else {
          current = { text: word.text, x0: word.x0, x1: word.x1 };
          row.cells.push(current);
        }
      });
      row.cells.forEach(function (cell) {
        cells.push(cell);
      });
    });

    const anchors = [];
    cells
      .slice()
      .sort(function (a, b) {
        return a.x0 - b.x0;
      })
      .forEach(function (cell) {
        const hit = anchors.find(function (item) {
          return Math.abs(item.anchor - cell.x0) <= gapLimit;
        });
        if (hit) {
          hit.count += 1;
          hit.anchor = (hit.anchor * (hit.count - 1) + cell.x0) / hit.count;
        } else {
          anchors.push({ anchor: cell.x0, count: 1 });
        }
      });

    anchors.sort(function (a, b) {
      return a.anchor - b.anchor;
    });
    return anchors.map(function (item) {
      return { center: item.anchor };
    });
  }

  function fromTesseract(data) {
    const words = normalizeWords(data);
    if (words.length < 4) return null;
    const medH = median(words.map(function (w) {
      return w.h;
    })) || 20;
    const medW = median(words.map(function (w) {
      return w.w;
    })) || medH;
    const rows = groupRows(words, medH * 0.65);
    const gapLimit = Math.max(medW * 0.9, medH * 0.8);
    const centers = clusterColumns(rows, gapLimit);
    if (centers.length < 2 || rows.length < 2) return null;

    const matrix = rows.map(function (row) {
      const line = new Array(centers.length).fill("");
      (row.cells || []).forEach(function (cell) {
        let best = 0;
        let bestDistance = Infinity;
        centers.forEach(function (col, index) {
          const distance = Math.abs(col.center - cell.x0);
          if (distance < bestDistance) {
            bestDistance = distance;
            best = index;
          }
        });
        line[best] = line[best] ? line[best] + " " + cell.text : cell.text;
      });
      return line;
    });

    const filled = matrix.filter(function (row) {
      return row.filter(Boolean).length >= 2;
    });
    if (filled.length < 2) return null;

    const keep = [];
    for (let c = 0; c < centers.length; c += 1) {
      if (filled.some(function (row) { return row[c]; })) keep.push(c);
    }
    if (keep.length < 2) return null;
    return filled.map(function (row) {
      return keep.map(function (c) { return row[c]; });
    });
  }

  function escapeCell(text) {
    return String(text == null ? "" : text)
      .replace(/\|/g, "\\|")
      .replace(/\r?\n/g, " ")
      .trim();
  }

  function toMarkdown(rows) {
    if (!rows || !rows.length) return "";
    const width = Math.max.apply(
      null,
      rows.map(function (row) {
        return row.length;
      })
    );
    const padded = rows.map(function (row) {
      const line = row.slice();
      while (line.length < width) line.push("");
      return line;
    });
    const header = "| " + padded[0].map(escapeCell).join(" | ") + " |";
    const divider = "| " + new Array(width).fill("---").join(" | ") + " |";
    const body = padded.slice(1).map(function (row) {
      return "| " + row.map(escapeCell).join(" | ") + " |";
    });
    return [header, divider].concat(body).join("\n");
  }

  function parseMarkdown(markdown) {
    if (!markdown) return [];
    return String(markdown)
      .split(/\r?\n/)
      .map(function (line) {
        return line.trim();
      })
      .filter(function (line) {
        return line.indexOf("|") !== -1;
      })
      .filter(function (line) {
        return !/^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(line);
      })
      .map(function (line) {
        return line
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map(function (cell) {
            return cell.replace(/\\\|/g, "|").trim();
          });
      })
      .filter(function (row) {
        return row.some(Boolean);
      });
  }

  function toCsv(rows) {
    return (rows || [])
      .map(function (row) {
        return row
          .map(function (cell) {
            const value = String(cell == null ? "" : cell);
            if (/[",\r\n]/.test(value)) {
              return '"' + value.replace(/"/g, '""') + '"';
            }
            return value;
          })
          .join(",");
      })
      .join("\n");
  }

  window.OCRTable = {
    fromTesseract: fromTesseract,
    toMarkdown: toMarkdown,
    parseMarkdown: parseMarkdown,
    toCsv: toCsv
  };
})();