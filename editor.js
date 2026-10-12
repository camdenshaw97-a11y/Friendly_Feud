/* Question editor: used on the TV page and on the host's phone. */
(function () {
  'use strict';
  var F = window.Feud;
  var KEY = 'feud.custom';

  F.savedQuestions = function () { return F.store.get(KEY, []); };

  F.openEditor = function (opts) {
    // opts: { list: [...], onChange(list) }
    var list = JSON.parse(JSON.stringify(opts.list || []));
    var back = document.createElement('div');
    back.className = 'ed-back';
    document.body.appendChild(back);

    function commit() {
      F.store.set(KEY, list);
      opts.onChange(list);
    }
    function close() {
      if (F.motionOK && F.motionOK()) { back.classList.add('out'); setTimeout(function () { back.remove(); }, 200); }
      else back.remove();
      if (opts.onClose) opts.onClose();
    }

    function showList() {
      var h = '<div class="ed"><div class="ed-top"><h2>MY QUESTIONS (' + list.length + ')</h2>' +
        '<button class="ed-btn" data-a="close">Done</button></div>' +
        '<p>Your own questions are used first, then the built-in ones fill any rounds left over. ' +
        'They are saved on this device and reload automatically next time.</p>' +
        '<div class="ed-row"><button class="ed-btn pri" data-a="add">+ Add a question</button>' +
        '<button class="ed-btn ghost" data-a="export"' + (list.length ? '' : ' disabled') + '>Save to file</button>' +
        '<button class="ed-btn ghost" data-a="import">Load from file</button></div>';
      if (!list.length) h += '<div class="ed-empty">No questions yet. Add one, and give each answer a point value the way the show does.</div>';
      list.forEach(function (q, i) {
        h += '<div class="ed-q"><b>' + F.esc(q.text) + '<small>' + q.answers.length + ' answers · top: ' +
          F.esc(q.answers[0].text) + ' (' + q.answers[0].pts + ')</small></b>' +
          '<button class="ed-btn" data-a="edit" data-i="' + i + '">Edit</button>' +
          '<button class="ed-btn red" data-a="del" data-i="' + i + '">Delete</button></div>';
      });
      h += '<input type="file" accept=".json,application/json" style="display:none" data-file></div>';
      back.innerHTML = h;
    }

    function showForm(i) {
      var q = i == null ? { text: '', answers: [] } : list[i];
      var h = '<div class="ed"><div class="ed-top"><h2>' + (i == null ? 'NEW QUESTION' : 'EDIT QUESTION') + '</h2></div>' +
        '<label>QUESTION</label><textarea data-q maxlength="160" placeholder="Name something people do at a red light.">' + F.esc(q.text) + '</textarea>' +
        '<label>ANSWERS AND POINTS (at least 3, up to 8)</label>';
      for (var k = 0; k < 8; k++) {
        var a = q.answers[k] || { text: '', pts: '' };
        h += '<div class="ed-ans"><span>' + (k + 1) + '</span><input data-at maxlength="40" placeholder="Answer" value="' + F.esc(a.text) + '">' +
          '<input data-ap type="number" inputmode="numeric" min="1" max="99" placeholder="Pts" value="' + F.esc(a.pts) + '"></div>';
      }
      h += '<div class="ed-err" data-err></div><div class="ed-row"><button class="ed-btn pri" data-a="save" data-i="' + (i == null ? '' : i) + '">Save question</button>' +
        '<button class="ed-btn ghost" data-a="cancel">Cancel</button></div></div>';
      back.innerHTML = h;
      back.scrollTop = 0;
    }

    function save(i) {
      var text = back.querySelector('[data-q]').value.trim();
      var ts = back.querySelectorAll('[data-at]'), ps = back.querySelectorAll('[data-ap]');
      var answers = [], err = '';
      for (var k = 0; k < ts.length; k++) {
        var t = ts[k].value.trim(), p = parseInt(ps[k].value, 10);
        if (!t && !ps[k].value) continue;
        if (!t) { err = 'Answer ' + (k + 1) + ' has points but no text.'; break; }
        if (!(p >= 1 && p <= 99)) { err = 'Give "' + t + '" a point value from 1 to 99.'; break; }
        answers.push({ text: t, pts: p });
      }
      if (!err && !text) err = 'Type the question first.';
      if (!err && answers.length < 3) err = 'Add at least 3 answers.';
      if (err) { back.querySelector('[data-err]').textContent = err; return; }
      answers.sort(function (a, b) { return b.pts - a.pts; });
      var q = { text: text, answers: answers };
      if (i === '') list.push(q); else list[Number(i)] = q;
      commit(); showList();
    }

    function importFile(file) {
      var r = new FileReader();
      r.onload = function () {
        try {
          var data = JSON.parse(r.result);
          var arr = Array.isArray(data) ? data : data.questions;
          var added = 0;
          arr.forEach(function (q) {
            if (q && q.text && Array.isArray(q.answers) && q.answers.length >= 2) {
              list.push({
                text: String(q.text).slice(0, 160),
                answers: q.answers.slice(0, 8).map(function (a) { return { text: String(a.text).slice(0, 40), pts: Math.max(1, Math.min(99, parseInt(a.pts, 10) || 1)) }; })
                  .sort(function (a, b) { return b.pts - a.pts; })
              });
              added++;
            }
          });
          if (added) commit();
          showList();
        } catch (e) { showList(); }
      };
      r.readAsText(file);
    }

    back.addEventListener('click', function (e) {
      var b = e.target.closest('[data-a]');
      if (!b) return;
      var a = b.dataset.a, i = b.dataset.i;
      if (a === 'close') close();
      else if (a === 'add') showForm(null);
      else if (a === 'edit') showForm(Number(i));
      else if (a === 'del') { list.splice(Number(i), 1); commit(); showList(); }
      else if (a === 'cancel') showList();
      else if (a === 'save') save(i);
      else if (a === 'import') back.querySelector('[data-file]').click();
      else if (a === 'export') {
        var blob = new Blob([JSON.stringify({ questions: list }, null, 2)], { type: 'application/json' });
        var link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'feud-questions.json';
        link.click();
        setTimeout(function () { URL.revokeObjectURL(link.href); }, 2000);
      }
    });
    back.addEventListener('change', function (e) {
      if (e.target.matches('[data-file]') && e.target.files[0]) importFile(e.target.files[0]);
    });

    showList();
    return { close: close };
  };
})();
