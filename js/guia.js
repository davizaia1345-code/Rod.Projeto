(function () {
    'use strict';
    var abas = Array.prototype.slice.call(document.querySelectorAll('.guia-abas [role="tab"]'));
    var NOMES = { liso: 'liso', ondulado: 'ondulado', cacheado: 'cacheado', crespo: 'crespo', barba: 'barba' };

    function mostrar(tipo, focar) {
        if (!NOMES[tipo]) return;
        abas.forEach(function (a) {
            var sel = a.dataset.tipo === tipo;
            a.setAttribute('aria-selected', sel ? 'true' : 'false');
            a.tabIndex = sel ? 0 : -1;
            document.getElementById('painel-' + a.dataset.tipo).hidden = !sel;
            if (sel && focar) a.focus();
        });
        try { history.replaceState(null, '', '#' + tipo); } catch (e) {}
    }

    abas.forEach(function (a, i) {
        a.addEventListener('click', function () { mostrar(a.dataset.tipo); });
        a.addEventListener('keydown', function (e) {
            var alvo = null;
            if (e.key === 'ArrowRight') alvo = abas[(i + 1) % abas.length];
            else if (e.key === 'ArrowLeft') alvo = abas[(i - 1 + abas.length) % abas.length];
            else if (e.key === 'Home') alvo = abas[0];
            else if (e.key === 'End') alvo = abas[abas.length - 1];
            if (alvo) { e.preventDefault(); mostrar(alvo.dataset.tipo, true); }
        });
    });

    function irPara(tipo) {
        mostrar(tipo);
        document.getElementById('guia').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    document.querySelectorAll('.guia-tipos-rapidos a').forEach(function (a) {
        a.addEventListener('click', function (e) { e.preventDefault(); irPara(a.dataset.tipo); });
    });

    // abre direto no tipo do endereço (ex.: /guia#cacheado)
    var inicial = (location.hash || '').slice(1);
    if (NOMES[inicial]) mostrar(inicial);

    // ---- quiz: a resposta mais frequente decide (empate: vale a primeira pergunta, que é a mais confiável)
    var respostas = [];
    var perguntas = Array.prototype.slice.call(document.querySelectorAll('.quiz-pergunta'));
    var TEXTOS = {
        liso: 'Seu cabelo é <b>liso</b>. Foco em controlar a oleosidade e dar volume.',
        ondulado: 'Seu cabelo é <b>ondulado</b>. Foco em definir as ondas e controlar o frizz.',
        cacheado: 'Seu cabelo é <b>cacheado</b>. Foco em hidratação e definição dos cachos.',
        crespo: 'Seu cabelo é <b>crespo</b>. Foco em muita hidratação e cuidado ao pentear.'
    };
    perguntas.forEach(function (p, i) {
        p.addEventListener('click', function (e) {
            var b = e.target.closest('button'); if (!b) return;
            respostas[i] = b.dataset.v;
            p.querySelectorAll('button').forEach(function (x) { x.classList.toggle('escolhido', x === b); x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
            if (i + 1 < perguntas.length) {
                perguntas[i + 1].hidden = false;
                perguntas[i + 1].querySelector('button').focus();
            } else {
                var conta = {};
                respostas.forEach(function (r) { conta[r] = (conta[r] || 0) + 1; });
                var tipo = respostas[0];
                Object.keys(conta).forEach(function (k) { if (conta[k] > conta[tipo]) tipo = k; });
                var res = document.getElementById('quiz-resultado');
                res.hidden = false;
                res.innerHTML = '<p><i class="fas fa-circle-check"></i> ' + TEXTOS[tipo] + '</p>' +
                    '<div class="quiz-acoes"><button type="button" class="btn-cta-precos" id="quiz-ver"><i class="fas fa-book-open"></i> Ver meu guia</button>' +
                    '<button type="button" class="guia-link" id="quiz-refazer"><i class="fas fa-rotate-right"></i> Refazer</button></div>';
                document.getElementById('quiz-ver').addEventListener('click', function () { irPara(tipo); });
                document.getElementById('quiz-refazer').addEventListener('click', function () {
                    respostas = []; res.hidden = true;
                    perguntas.forEach(function (q, j) { q.hidden = j > 0; q.querySelectorAll('button').forEach(function (x) { x.classList.remove('escolhido'); x.removeAttribute('aria-pressed'); }); });
                    perguntas[0].querySelector('button').focus();
                });
            }
        });
    });
})();
