// Janela para escolher dia e horário livres (remarcar e agendar pelo painel)
// RodSeletor.abrir({ api, titulo, subtitulo, textoBotao, extraHtml, coletarExtra(), aoConfirmar({ data, hora, extra }) })
(function () {
    var esc = function (v) { return window.RodAuth ? RodAuth.esc(v) : String(v); };
    var HORARIOS = [];
    [[9 * 60, 11 * 60 + 30], [13 * 60, 21 * 60 + 30]].forEach(function (f) {
        for (var t = f[0]; t <= f[1]; t += 35) HORARIOS.push(('0' + Math.floor(t / 60)).slice(-2) + ':' + ('0' + (t % 60)).slice(-2));
    });

    function abrir(op) {
        var antigo = document.getElementById('sel-overlay'); if (antigo) antigo.remove();
        var estado = { data: '', hora: '', busca: 0 };
        var voltarPara = document.activeElement;
        var ov = document.createElement('div');
        ov.id = 'sel-overlay'; ov.className = 'sel-overlay';
        ov.innerHTML =
            '<div class="sel-janela" role="dialog" aria-modal="true" aria-labelledby="sel-titulo">' +
            '<button type="button" class="sel-fechar" aria-label="Fechar"><i class="fas fa-xmark"></i></button>' +
            '<h3 id="sel-titulo"><i class="far fa-calendar-check"></i> ' + esc(op.titulo || 'Escolha o horário') + '</h3>' +
            (op.subtitulo ? '<p class="sel-sub">' + op.subtitulo + '</p>' : '') +
            (op.extraHtml || '') +
            '<span class="sel-rotulo">Dia</span><div class="sel-dias" role="radiogroup" aria-label="Dia"></div>' +
            '<label class="sel-rotulo" for="sel-data">Outra data</label><input type="date" id="sel-data" class="sel-data">' +
            '<span class="sel-rotulo">Horário</span><p class="sel-aviso" aria-live="polite">Escolha um dia.</p><div class="sel-horas" role="radiogroup" aria-label="Horário"></div>' +
            '<p class="sel-erro" role="alert"></p>' +
            '<button type="button" class="sel-confirmar" disabled><i class="fas fa-check"></i> ' + esc(op.textoBotao || 'Confirmar') + '</button>' +
            '</div>';
        document.body.appendChild(ov);
        document.body.classList.add('sem-rolagem');
        var $ = function (s) { return ov.querySelector(s); };

        function fechar() { ov.remove(); document.body.classList.remove('sem-rolagem'); document.removeEventListener('keydown', teclas); if (voltarPara && voltarPara.focus) voltarPara.focus(); }
        function teclas(e) { if (e.key === 'Escape') fechar(); }
        document.addEventListener('keydown', teclas);
        $('.sel-fechar').addEventListener('click', fechar);
        ov.addEventListener('click', function (e) { if (e.target === ov) fechar(); });

        var dias = $('.sel-dias');
        for (var i = 0; i < 14; i++) {
            var iso = RodUtil.hojeSP(i), b = document.createElement('button');
            b.type = 'button'; b.className = 'day-chip'; b.dataset.data = iso; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', 'false');
            b.setAttribute('aria-label', RodUtil.dataExtenso(iso));
            b.innerHTML = '<span class="day-nome">' + (i === 0 ? 'Hoje' : i === 1 ? 'Amanhã' : esc(RodUtil.diaDaSemana(iso, 'short'))) + '</span><span class="day-num">' + iso.slice(8) + '</span>';
            dias.appendChild(b);
        }
        dias.addEventListener('click', function (e) { var c = e.target.closest('.day-chip'); if (c) escolherDia(c.dataset.data); });
        var inp = $('#sel-data'); inp.min = RodUtil.hojeSP(0); inp.max = RodUtil.hojeSP(90);
        inp.addEventListener('change', function () { if (inp.value) escolherDia(inp.value); });

        function atualizarBotao() { $('.sel-confirmar').disabled = !(estado.data && estado.hora); }

        function escolherDia(iso) {
            estado.data = iso; estado.hora = ''; inp.value = iso; atualizarBotao();
            dias.querySelectorAll('.day-chip').forEach(function (c) { var s = c.dataset.data === iso; c.classList.toggle('selected', s); c.setAttribute('aria-checked', s ? 'true' : 'false'); });
            carregar(iso);
        }

        async function carregar(iso) {
            var minha = ++estado.busca, horas = $('.sel-horas'), aviso = $('.sel-aviso');
            horas.innerHTML = ''; aviso.textContent = 'Carregando horários...';
            try {
                var r = await fetch(op.api + '/agenda?data=' + encodeURIComponent(iso));
                var ag = await r.json();
                if (minha !== estado.busca) return;
                if (!r.ok) throw new Error();
                if (ag.diaFechado) { aviso.textContent = 'Sem atendimento neste dia.'; return; }
                var ocup = {}; (ag.ocupados || []).concat(ag.bloqueados || []).forEach(function (h) { ocup[h] = true; });
                var livres = 0;
                HORARIOS.forEach(function (h) {
                    var p = h.split(':'), min = +p[0] * 60 + +p[1];
                    if (ag.data === ag.hoje && min <= ag.minutosAgora) return;
                    var b = document.createElement('button');
                    b.type = 'button'; b.textContent = h; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', 'false');
                    if (ocup[h]) { b.className = 'time-btn ocupado'; b.disabled = true; }
                    else { b.className = 'time-btn'; livres++; }
                    horas.appendChild(b);
                });
                aviso.textContent = livres ? livres + (livres === 1 ? ' horário livre' : ' horários livres') : 'Nenhum horário livre neste dia.';
            } catch (e) { if (minha === estado.busca) aviso.textContent = 'Não foi possível carregar. Tente de novo.'; }
        }
        $('.sel-horas').addEventListener('click', function (e) {
            var b = e.target.closest('.time-btn'); if (!b || b.disabled) return;
            estado.hora = b.textContent;
            ov.querySelectorAll('.sel-horas .time-btn').forEach(function (x) { var s = x === b; x.classList.toggle('selected', s); x.setAttribute('aria-checked', s ? 'true' : 'false'); });
            atualizarBotao();
        });

        $('.sel-confirmar').addEventListener('click', async function () {
            var btn = this, erro = $('.sel-erro');
            erro.textContent = '';
            var extra = null;
            if (op.coletarExtra) { extra = op.coletarExtra(ov); if (typeof extra === 'string') { erro.textContent = extra; return; } }
            btn.disabled = true; var rot = btn.innerHTML; btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Salvando...';
            try {
                var msg = await op.aoConfirmar({ data: estado.data, hora: estado.hora, extra: extra });
                if (msg) { erro.textContent = msg; btn.disabled = false; btn.innerHTML = rot; if (estado.data) carregar(estado.data); return; }
                fechar();
            } catch (e) { erro.textContent = 'Sem conexão. Tente de novo.'; btn.disabled = false; btn.innerHTML = rot; }
        });

        var primeiro = ov.querySelector('input:not([type="date"]), select') || dias.querySelector('.day-chip');
        if (primeiro) primeiro.focus();
        if (op.dataInicial) escolherDia(op.dataInicial);
    }

    window.RodSeletor = { abrir: abrir };
})();
