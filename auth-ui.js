// Detalhes de interface das telas de conta: mostrar senha, Caps Lock, força da senha, mensagens, botão de carregando
(function () {
    function el(tag, classe, html) { var e = document.createElement(tag); if (classe) e.className = classe; if (html) e.innerHTML = html; return e; }

    // coloca o botão "olho" dentro do campo e avisa quando o Caps Lock está ligado
    function campoSenha(input) {
        var wrap = el('div', 'senha-wrap');
        input.parentNode.insertBefore(wrap, input);
        wrap.appendChild(input);
        var btn = el('button', 'senha-olho', '<i class="far fa-eye" aria-hidden="true"></i>');
        btn.type = 'button'; btn.setAttribute('aria-label', 'Mostrar senha'); btn.setAttribute('aria-pressed', 'false'); btn.tabIndex = 0;
        btn.addEventListener('click', function () {
            var mostrar = input.type === 'password';
            input.type = mostrar ? 'text' : 'password';
            btn.setAttribute('aria-pressed', mostrar ? 'true' : 'false');
            btn.setAttribute('aria-label', mostrar ? 'Ocultar senha' : 'Mostrar senha');
            btn.firstChild.className = mostrar ? 'far fa-eye-slash' : 'far fa-eye';
            input.focus();
        });
        wrap.appendChild(btn);
        var caps = el('p', 'caps-aviso', '<i class="fas fa-triangle-exclamation"></i> Caps Lock está ligado');
        caps.hidden = true;
        wrap.parentNode.insertBefore(caps, wrap.nextSibling);
        var checar = function (e) { if (e.getModifierState) caps.hidden = !e.getModifierState('CapsLock'); };
        input.addEventListener('keydown', checar); input.addEventListener('keyup', checar);
        input.addEventListener('blur', function () { caps.hidden = true; });
        return wrap;
    }

    // medidor de força: tamanho + variedade de caracteres
    function pontuar(s) {
        if (!s) return 0;
        var p = 0;
        if (s.length >= 8) p++;
        if (s.length >= 12) p++;
        if (/[a-z]/.test(s) && /[A-Z]/.test(s)) p++;
        if (/\d/.test(s) && /[^A-Za-z0-9]/.test(s)) p++; else if (/\d/.test(s) || /[^A-Za-z0-9]/.test(s)) p += 0.5;
        if (s.length < 8) return Math.min(p, 1);
        return Math.min(4, Math.max(1, Math.floor(p)));
    }

    function medidorForca(input) {
        var caixa = el('div', 'forca'), segs = '';
        for (var i = 0; i < 4; i++) segs += '<span></span>';
        caixa.innerHTML = '<div class="forca-barras">' + segs + '</div><span class="forca-texto" aria-live="polite"></span>';
        var anchor = input.closest('.senha-wrap') || input;
        anchor.parentNode.insertBefore(caixa, anchor.nextSibling);
        var nomes = ['', 'Fraca', 'Razoável', 'Boa', 'Forte'];
        function atualizar() {
            var s = input.value, n = pontuar(s);
            caixa.dataset.nivel = s ? String(n) : '0';
            var barras = caixa.querySelectorAll('.forca-barras span');
            for (var i = 0; i < barras.length; i++) barras[i].classList.toggle('on', i < n);
            caixa.querySelector('.forca-texto').textContent = !s ? '' : (s.length < 8 ? 'Mínimo de 8 caracteres' : 'Senha ' + nomes[n].toLowerCase());
        }
        input.addEventListener('input', atualizar); atualizar();
    }

    // mensagem de resultado com ícone
    function mensagem(alvo, tipo, texto) {
        alvo.className = 'auth-msg ' + tipo;
        alvo.textContent = '';
        if (!texto) return;
        var i = document.createElement('i');
        i.className = 'fas ' + (tipo === 'ok' ? 'fa-circle-check' : tipo === 'info' ? 'fa-circle-info' : 'fa-triangle-exclamation');
        i.setAttribute('aria-hidden', 'true');
        var s = document.createElement('span'); s.textContent = texto;
        alvo.appendChild(i); alvo.appendChild(s);
    }

    function carregando(btn, ligado, texto) {
        if (ligado) { btn.dataset.rotulo = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> ' + texto; }
        else { btn.disabled = false; if (btn.dataset.rotulo) btn.innerHTML = btn.dataset.rotulo; }
    }

    // já tem sessão válida: não precisa ver login/cadastro de novo
    function pularSeLogado() {
        if (window.RodAuth && RodAuth.logado()) { window.location.replace(RodAuth.papel() === 'owner' ? '/admin' : '/'); return true; }
        return false;
    }

    // acorda o servidor (plano gratuito dorme) enquanto a pessoa digita
    function aquecer(api) { try { fetch(api + '/health').catch(function () {}); } catch (e) {} }

    // (11) 91234-5678 enquanto digita
    function mascaraTelefone(input) {
        input.addEventListener('input', function () {
            var d = input.value.replace(/\D/g, '').slice(0, 11);
            var r = d;
            if (d.length > 2) r = '(' + d.slice(0, 2) + ') ' + d.slice(2);
            if (d.length > 6) r = '(' + d.slice(0, 2) + ') ' + d.slice(2, d.length - 4) + '-' + d.slice(-4);
            input.value = r;
        });
    }

    window.RodUI = { mascaraTelefone: mascaraTelefone, campoSenha: campoSenha, medidorForca: medidorForca, mensagem: mensagem, carregando: carregando, pularSeLogado: pularSeLogado, aquecer: aquecer };
})();
