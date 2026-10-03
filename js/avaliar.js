(function () {
    'use strict';
    var API_URL = 'https://rodbarber-api-0jna.onrender.com';
    var $ = function (id) { return document.getElementById(id); };
    var params = new URLSearchParams(window.location.search);
    var t = params.get('t') || '';
    var nota = Number(params.get('n')) || 0;
    var LEGENDAS = ['Toque nas estrelas', 'Ruim', 'Poderia ser melhor', 'Bom', 'Muito bom', 'Excelente!'];
    // o link fica fora do histórico/barra de endereço
    try { history.replaceState(null, '', window.location.pathname); } catch (e) {}

    function marcar(n) {
        nota = n;
        document.querySelectorAll('#estrelas button').forEach(function (b) {
            var on = Number(b.dataset.n) <= n;
            b.classList.toggle('on', on);
            b.setAttribute('aria-checked', Number(b.dataset.n) === n ? 'true' : 'false');
        });
        $('estrelas-legenda').textContent = LEGENDAS[n] || LEGENDAS[0];
    }

    function resultado(icone, titulo, texto, extra) {
        $('form-avaliar').hidden = true; $('carregando').hidden = true;
        var r = $('resultado'); r.hidden = false;
        r.innerHTML = '<div class="success-badge' + (icone === 'erro' ? ' erro' : '') + '"><i class="fas ' + (icone === 'erro' ? 'fa-xmark' : 'fa-check') + '"></i></div>' +
            '<h1></h1><p class="auth-subtitle"></p>' + (extra || '') +
            '<a href="/" class="btn-login-cta"><i class="far fa-calendar-plus"></i> Agendar um horário</a>';
        r.querySelector('h1').textContent = titulo;
        r.querySelector('p').textContent = texto;
    }

    async function iniciar() {
        if (!t) { resultado('erro', 'Link inválido', 'Abra o link que chegou no seu e-mail para avaliar.'); return; }
        try {
            var r = await fetch(API_URL + '/avaliacoes/convite?t=' + encodeURIComponent(t));
            var d = await r.json().catch(function () { return {}; });
            if (!r.ok) { resultado('erro', 'Link inválido', d.mensagem || 'Não encontramos esse atendimento.'); return; }
            if (d.avaliado) { resultado('ok', 'Você já avaliou', 'Obrigado! Sua opinião já foi registrada.'); return; }
            $('avaliar-sub').textContent = 'Olá, ' + (d.nome || 'cliente') + '! Como foi o seu ' + d.servico + ' de ' + RodUtilData(d.data) + '?';
            $('carregando').hidden = true; $('form-avaliar').hidden = false;
            marcar(nota >= 1 && nota <= 5 ? nota : 0);
        } catch (e) {
            resultado('erro', 'Sem conexão', 'Não foi possível abrir a avaliação agora. Tente de novo em alguns segundos.');
        }
    }
    function RodUtilData(iso) { var p = String(iso || '').split('-'); return p.length === 3 ? p[2] + '/' + p[1] : ''; }

    $('estrelas').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) marcar(Number(b.dataset.n)); });
    $('estrelas').addEventListener('keydown', function (e) {
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); marcar(Math.min(5, nota + 1)); document.querySelector('#estrelas [data-n="' + nota + '"]').focus(); }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); marcar(Math.max(1, nota - 1)); document.querySelector('#estrelas [data-n="' + nota + '"]').focus(); }
    });
    $('comentario').addEventListener('input', function () { $('contador').textContent = this.value.length; });

    $('form-avaliar').addEventListener('submit', async function (e) {
        e.preventDefault();
        var msg = $('mensagem'), btn = this.querySelector('button[type="submit"]');
        if (!nota) { RodUI.mensagem(msg, 'erro', 'Escolha de 1 a 5 estrelas.'); return; }
        RodUI.carregando(btn, true, 'Enviando...'); RodUI.mensagem(msg, '', '');
        try {
            var r = await fetch(API_URL + '/avaliacoes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ t: t, nota: nota, comentario: $('comentario').value.trim() }) });
            var d = await r.json().catch(function () { return {}; });
            if (r.ok || r.status === 409) {
                var extra = nota >= 4 ? '<p class="avaliar-insta">Curtiu? Marque <a href="https://www.instagram.com/souzard_barber/" target="_blank" rel="noopener noreferrer"><i class="fab fa-instagram"></i> @souzard_barber</a> na sua foto!</p>' : '';
                resultado('ok', 'Obrigado!', r.ok ? 'Sua avaliação ajuda o Rod a melhorar sempre.' : (d.mensagem || 'Este atendimento já foi avaliado.'), extra);
            } else { RodUI.mensagem(msg, 'erro', d.mensagem || 'Não foi possível enviar.'); RodUI.carregando(btn, false); }
        } catch (err) { RodUI.mensagem(msg, 'erro', 'Sem conexão. Tente de novo.'); RodUI.carregando(btn, false); }
    });

    iniciar();
})();
