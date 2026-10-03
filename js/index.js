(function () {
    'use strict';
    var API_URL = 'https://rodbarber-api-0jna.onrender.com';
    var MAX_DIAS = 90;

    var SERVICOS = [
        { nome: 'Corte Masculino',     preco: 40,  min: 40,  icone: 'fa-scissors' },
        { nome: 'Barba Completa',      preco: 20,  min: 20,  icone: 'fa-user-tie' },
        { nome: 'Corte + Barba',       preco: 60,  min: 60,  icone: 'fa-star' },
        { nome: 'Sobrancelha',         preco: 10,  min: 10,  icone: 'fa-eye' },
        { nome: 'Progressiva + Corte', preco: 120, min: 120, icone: 'fa-wind' },
        { nome: 'Luzes + Corte',       preco: 100, min: 90,  icone: 'fa-wand-magic-sparkles' }
    ];
    var estado = { servico: null, data: '', hora: '', agenda: null };
    var contadorBusca = 0, intervaloPagamento = null, intervaloPrazo = null;

    var $ = function (id) { return document.getElementById(id); };
    var esc = RodAuth.esc;
    var Tema = Swal.mixin({ background: '#151310', color: '#f4efe4', confirmButtonColor: '#c7a04a' });
    var Toast = Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer: 3000, timerProgressBar: true, background: '#1c1a16', color: '#f4efe4' });

    function duracao(min) { return min < 60 ? min + ' min' : (min % 60 ? Math.floor(min / 60) + 'h ' + (min % 60) + 'min' : (min / 60) + 'h'); }
    function precoCurto(p) { return Number.isInteger(p) ? 'R$ ' + p : RodUtil.brl(p); }
    function servicoPorNome(n) { return SERVICOS.filter(function (s) { return s.nome === n; })[0]; }
    function minutos(hhmm) { var p = hhmm.split(':'); return +p[0] * 60 + +p[1]; }

    window.fecharMenuMobile = function () { $('menu-toggle').checked = false; };
    window.fazerLogout = function () { RodAuth.sair(); };

    // ---------------------------------------------------------------- status "aberto agora"
    function atualizarStatus() {
        var el = $('status-live'), texto = $('status-live-text');
        var p = {};
        new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false })
            .formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; });
        var min = (parseInt(p.hour, 10) % 24) * 60 + parseInt(p.minute, 10);
        var aberto = (min >= 9 * 60 && min <= 11 * 60 + 30) || (min >= 13 * 60 && min <= 21 * 60 + 30);
        el.classList.toggle('is-open', aberto);
        el.classList.toggle('is-closed', !aberto);
        texto.textContent = aberto ? 'Agendamentos abertos agora' : 'Fora do horário de atendimento';
    }
    atualizarStatus(); setInterval(atualizarStatus, 60000);

    // ---------------------------------------------------------------- serviços e preços (uma só fonte)
    function desenharServicos() {
        var lista = $('lista-servicos');
        lista.innerHTML = '';
        SERVICOS.forEach(function (s) {
            var b = document.createElement('button');
            b.type = 'button'; b.className = 'service-card'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', 'false');
            b.dataset.servico = s.nome;
            b.innerHTML = '<i class="fas ' + s.icone + ' service-icon" aria-hidden="true"></i>' +
                '<span class="service-info"><span class="service-name">' + esc(s.nome) + '</span>' +
                '<span class="service-time"><i class="far fa-clock" aria-hidden="true"></i> ' + duracao(s.min) + '</span></span>' +
                '<span class="service-price">' + precoCurto(s.preco) + '</span>';
            b.addEventListener('click', function () { selecionarServico(s.nome); });
            lista.appendChild(b);
        });
        var precos = $('lista-precos');
        precos.innerHTML = '';
        SERVICOS.forEach(function (s) {
            var d = document.createElement('div');
            d.className = 'preco-item';
            d.innerHTML = '<span class="nome-servico"><i class="fas ' + s.icone + '" aria-hidden="true"></i><span>' + esc(s.nome) + '<small>' + duracao(s.min) + '</small></span></span>' +
                '<span class="preco-valor">' + RodUtil.brl(s.preco) + '</span>';
            precos.appendChild(d);
        });
    }

    // preços e serviços vêm do servidor (o dono edita no painel); os valores acima são só o plano B
    function aplicarServicos(lista) {
        SERVICOS = lista.map(function (x) { return { nome: x.nome, preco: Number(x.preco), min: Number(x.minutos), icone: /^fa-[a-z-]+$/.test(x.icone || '') ? x.icone : 'fa-scissors' }; });
        SERVICOS.forEach(function (s) { RodUtil.duracoes[s.nome] = s.min; });
        desenharServicos();
        if (estado.servico && !servicoPorNome(estado.servico)) { estado.servico = null; $('servico-selecionado').value = ''; }
        else if (estado.servico) selecionarServico(estado.servico);
        atualizarResumo();
    }
    function carregarServicos() {
        fetch(API_URL + '/servicos').then(function (r) { return r.ok ? r.json() : Promise.reject(); })
            .then(function (lista) { if (Array.isArray(lista) && lista.length) aplicarServicos(lista); }).catch(function () { /* mantém os padrões */ });
    }

    function selecionarServico(nome) {
        estado.servico = nome;
        $('servico-selecionado').value = nome;
        document.querySelectorAll('.service-card').forEach(function (c) {
            var sel = c.dataset.servico === nome;
            c.classList.toggle('selected', sel); c.setAttribute('aria-checked', sel ? 'true' : 'false');
        });
        atualizarResumo();
    }

    // ---------------------------------------------------------------- dias
    function desenharDias() {
        var faixa = $('faixa-dias');
        var hoje = RodUtil.hojeSP(0);
        for (var i = 0; i < 7; i++) {
            var iso = RodUtil.hojeSP(i);
            var b = document.createElement('button');
            b.type = 'button'; b.className = 'day-chip'; b.dataset.data = iso; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', 'false');
            var rotulo = iso === hoje ? 'Hoje' : (i === 1 ? 'Amanhã' : RodUtil.diaDaSemana(iso, 'short'));
            b.setAttribute('aria-label', RodUtil.dataExtenso(iso));
            b.innerHTML = '<span class="day-nome">' + esc(rotulo) + '</span><span class="day-num">' + iso.slice(8) + '</span>';
            b.addEventListener('click', function () { escolherData(this.dataset.data); });
            faixa.appendChild(b);
        }
        var inp = $('data');
        inp.min = hoje; inp.max = RodUtil.hojeSP(MAX_DIAS);
        inp.addEventListener('change', function () { if (inp.value) escolherData(inp.value); else { estado.data = ''; estado.hora = ''; $('hora-selecionada').value = ''; $('container-horarios').innerHTML = ''; $('aviso-horario').style.display = 'block'; $('aviso-horario').textContent = 'Escolha um dia para ver os horários.'; marcarChips(''); atualizarResumo(); } });
    }

    function marcarChips(iso) {
        document.querySelectorAll('.day-chip').forEach(function (c) {
            var sel = c.dataset.data === iso;
            c.classList.toggle('selected', sel); c.setAttribute('aria-checked', sel ? 'true' : 'false');
        });
    }

    function escolherData(iso) {
        if (iso < RodUtil.hojeSP(0) || iso > RodUtil.hojeSP(MAX_DIAS)) {
            Toast.fire({ icon: 'info', title: 'Escolha uma data entre hoje e os próximos ' + MAX_DIAS + ' dias.' });
            $('data').value = ''; return;
        }
        estado.data = iso; estado.hora = ''; $('hora-selecionada').value = '';
        $('data').value = iso;
        marcarChips(iso);
        atualizarResumo();
        carregarHorarios(false);
    }

    // ---------------------------------------------------------------- horários
    function esqueleto() {
        var h = '<div class="time-group"><span class="time-group-label skel skel-linha"></span><div class="time-grid">';
        for (var i = 0; i < 10; i++) h += '<span class="time-btn skel"></span>';
        return h + '</div></div>';
    }

    async function carregarHorarios(silencioso) {
        var iso = estado.data;
        var container = $('container-horarios'), aviso = $('aviso-horario');
        if (!iso) return;
        var minha = ++contadorBusca;
        var lento = null;
        if (!silencioso) {
            container.innerHTML = esqueleto();
            aviso.style.display = 'none';
            lento = setTimeout(function () { if (minha === contadorBusca) { aviso.className = 'aviso-horario info'; aviso.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Acordando o servidor, só um instante...'; aviso.style.display = 'block'; } }, 3500);
        }
        try {
            var r = await fetch(API_URL + '/agenda?data=' + encodeURIComponent(iso));
            if (!r.ok) throw new Error('http ' + r.status);
            var agenda = await r.json();
            if (minha !== contadorBusca) return;
            estado.agenda = agenda;
            desenharHorarios(agenda);
        } catch (e) {
            if (minha !== contadorBusca) return;
            if (silencioso) return;
            container.innerHTML = '';
            aviso.className = 'aviso-horario erro';
            aviso.innerHTML = '<i class="fas fa-triangle-exclamation"></i> Não foi possível carregar os horários. <button type="button" class="link-btn" id="btn-tentar">Tentar de novo</button>';
            aviso.style.display = 'block';
            $('btn-tentar').addEventListener('click', function () { carregarHorarios(false); });
        } finally { if (lento) clearTimeout(lento); }
    }

    function desenharHorarios(agenda) {
        var container = $('container-horarios'), aviso = $('aviso-horario');
        container.innerHTML = ''; aviso.className = 'aviso-horario'; aviso.style.display = 'none';

        if (agenda.diaFechado) {
            aviso.className = 'aviso-horario info'; aviso.innerHTML = '<i class="fas fa-ban"></i> Não há atendimento neste dia. Escolha outra data.'; aviso.style.display = 'block';
            if (estado.hora) { estado.hora = ''; $('hora-selecionada').value = ''; atualizarResumo(); }
            return;
        }
        var indisponiveis = {};
        (agenda.ocupados || []).concat(agenda.bloqueados || []).forEach(function (h) { indisponiveis[h] = true; });
        var ehHoje = agenda.data === agenda.hoje;
        var livres = 0, mostrados = 0;

        function grupo(titulo, icone, ini, fim) {
            var grid = document.createElement('div'); grid.className = 'time-grid';
            for (var t = ini; t <= fim; t += 35) {
                if (ehHoje && t <= agenda.minutosAgora) continue;          // já passou
                var hh = ('0' + Math.floor(t / 60)).slice(-2) + ':' + ('0' + (t % 60)).slice(-2);
                var b = document.createElement('button'); b.type = 'button'; b.textContent = hh; b.setAttribute('role', 'radio');
                mostrados++;
                if (indisponiveis[hh]) { b.className = 'time-btn ocupado'; b.disabled = true; b.setAttribute('aria-checked', 'false'); b.setAttribute('aria-label', hh + ', indisponível'); }
                else {
                    livres++; b.className = 'time-btn'; b.setAttribute('aria-checked', 'false');
                    if (estado.hora === hh) { b.classList.add('selected'); b.setAttribute('aria-checked', 'true'); }
                    b.addEventListener('click', function () { selecionarHora(this.textContent); });
                }
                grid.appendChild(b);
            }
            if (!grid.children.length) return;
            var g = document.createElement('div'); g.className = 'time-group';
            g.innerHTML = '<span class="time-group-label"><i class="fas ' + icone + '" aria-hidden="true"></i> ' + titulo + '</span>';
            g.appendChild(grid); container.appendChild(g);
        }
        grupo('Manhã', 'fa-sun', 9 * 60, 11 * 60 + 30);
        grupo('Tarde e noite', 'fa-cloud-sun', 13 * 60, 21 * 60 + 30);

        if (estado.hora && indisponiveis[estado.hora]) {
            Toast.fire({ icon: 'info', title: 'O horário das ' + estado.hora + ' acabou de ser reservado. Escolha outro.' });
            estado.hora = ''; $('hora-selecionada').value = ''; atualizarResumo();
        }
        if (!mostrados) { aviso.className = 'aviso-horario info'; aviso.innerHTML = '<i class="far fa-moon"></i> Os horários de hoje já passaram. Escolha outro dia.'; aviso.style.display = 'block'; }
        else if (!livres) { aviso.className = 'aviso-horario info'; aviso.innerHTML = '<i class="fas fa-ban"></i> Agenda cheia neste dia. Tente outra data.'; aviso.style.display = 'block'; }
        else {
            aviso.className = 'aviso-horario livres'; aviso.style.display = 'block';
            aviso.innerHTML = '<i class="far fa-circle-check"></i> ' + livres + (livres === 1 ? ' horário disponível' : ' horários disponíveis');
        }
    }

    function selecionarHora(hh) {
        estado.hora = hh; $('hora-selecionada').value = hh;
        document.querySelectorAll('#container-horarios .time-btn').forEach(function (b) {
            var sel = b.textContent === hh; b.classList.toggle('selected', sel); b.setAttribute('aria-checked', sel ? 'true' : 'false');
        });
        atualizarResumo();
    }

    // ---------------------------------------------------------------- resumo vivo
    function faltando() {
        var f = [];
        if (!estado.servico) f.push('serviço');
        if (!estado.data) f.push('dia');
        if (!estado.hora) f.push('horário');
        return f;
    }

    function atualizarResumo() {
        var box = $('resumo-selecao'), btn = $('btn-confirmar'), dica = $('dica-form');
        var f = faltando();
        if (f.length === 3) { box.innerHTML = ''; box.classList.remove('ativo'); }
        else {
            var s = estado.servico && servicoPorNome(estado.servico);
            box.classList.add('ativo');
            box.innerHTML =
                '<div class="rs-linha"><i class="fas ' + (s ? s.icone : 'fa-scissors') + '" aria-hidden="true"></i><span>' + (s ? esc(s.nome) : '<em>Escolha o serviço</em>') + '</span></div>' +
                '<div class="rs-linha"><i class="far fa-calendar" aria-hidden="true"></i><span>' + (estado.data ? esc(RodUtil.dataExtenso(estado.data)) : '<em>Escolha o dia</em>') + '</span></div>' +
                '<div class="rs-linha"><i class="far fa-clock" aria-hidden="true"></i><span>' + (estado.hora ? esc(estado.hora) : '<em>Escolha o horário</em>') + '</span></div>' +
                (s ? '<div class="rs-total"><span>Total</span><strong>' + RodUtil.brl(s.preco) + '</strong></div>' : '');
        }
        btn.classList.toggle('incompleto', f.length > 0);
        btn.setAttribute('aria-disabled', f.length ? 'true' : 'false');
        dica.textContent = f.length ? 'Falta escolher: ' + f.join(', ') + '.' : 'Você poderá pagar com PIX ou cartão na próxima etapa.';
    }

    function irParaPasso(f) {
        var alvo = { 'serviço': 'passo-servico', 'dia': 'passo-data', 'horário': 'passo-hora' }[f[0]];
        var el = $(alvo); if (!el) return;
        el.classList.remove('treme'); void el.offsetWidth; el.classList.add('treme');
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // ---------------------------------------------------------------- envio
    function mostrarErroForm(texto) {
        var m = $('mensagem');
        m.innerHTML = '<div class="msg-erro"><i class="fas fa-triangle-exclamation"></i><span></span></div>';
        m.querySelector('span').textContent = texto;
    }

    $('form-agendamento').addEventListener('submit', async function (ev) {
        ev.preventDefault();
        $('mensagem').innerHTML = '';
        var f = faltando();
        if (f.length) { irParaPasso(f); $('dica-form').classList.add('destaque'); setTimeout(function () { $('dica-form').classList.remove('destaque'); }, 1200); return; }

        var botao = $('btn-confirmar');
        if (botao.disabled) return;
        botao.disabled = true; botao.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Reservando...';
        var restaurar = function () { botao.disabled = false; botao.innerHTML = '<i class="fas fa-check"></i> Confirmar Agendamento'; };
        var s = servicoPorNome(estado.servico);
        try {
            var resposta = await RodAuth.fetch(API_URL + '/agendar', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data: estado.data, hora: estado.hora, servico: estado.servico })
            });
            var resultado = await resposta.json().catch(function () { return {}; });
            if (resposta.ok) { mostrarReserva(resultado, s); return; }
            restaurar();
            mostrarErroForm(resultado.mensagem || 'Não foi possível agendar. Tente novamente.');
            if (resposta.status === 400) { estado.hora = ''; $('hora-selecionada').value = ''; atualizarResumo(); carregarHorarios(true); }
        } catch (e) {
            if (e && e.message === 'sessao_expirada') return;
            restaurar();
            mostrarErroForm('Sem conexão com o servidor. Confira sua internet e tente de novo.');
        }
    });

    // ---------------------------------------------------------------- tela pós-reserva
    function pararTimers() {
        if (intervaloPagamento) { clearInterval(intervaloPagamento); intervaloPagamento = null; }
        if (intervaloPrazo) { clearInterval(intervaloPrazo); intervaloPrazo = null; }
    }

    function restante(ateIso) {
        var ms = Date.parse(ateIso) - Date.now();
        if (ms <= 0) return 'prazo encerrado';
        var min = Math.ceil(ms / 60000);
        if (min < 60) return 'faltam ' + min + ' min';
        var h = Math.floor(min / 60), m = min % 60;
        if (h >= 48) return 'faltam ' + Math.floor(h / 24) + ' dias';
        return 'faltam ' + h + 'h' + (m ? ' ' + m + 'min' : '');
    }

    function linhasResumo(serv, reserva) {
        return '<div class="booking-summary">' +
            '<div class="summary-row"><span><i class="fas fa-scissors"></i> Serviço</span><strong>' + esc(serv.nome) + '</strong></div>' +
            '<div class="summary-row"><span><i class="far fa-calendar"></i> Data</span><strong>' + esc(RodUtil.dataBR(reserva.data)) + ' · ' + esc(RodUtil.diaDaSemana(reserva.data, 'short')) + '</strong></div>' +
            '<div class="summary-row"><span><i class="far fa-clock"></i> Horário</span><strong>' + esc(reserva.hora) + '</strong></div>' +
            '<div class="summary-row total"><span>Total</span><strong>' + RodUtil.brl(serv.preco) + '</strong></div></div>';
    }

    function mostrarReserva(r, serv) {
        pararTimers();
        var reserva = { servico: serv.nome, data: estado.data, hora: estado.hora };
        var email = RodAuth.esc(localStorage.getItem('usuarioEmail') || '');
        var form = $('form-agendamento'); form.style.display = 'none';
        document.querySelector('#area-formulario .form-title').style.display = 'none';
        document.querySelector('#area-formulario .form-subtitle').style.display = 'none';
        var msg = $('mensagem');
        msg.innerHTML =
            '<div class="success-container">' +
            '<div class="success-badge"><i class="fas fa-check"></i></div>' +
            '<h3 class="success-title">Horário reservado!</h3>' +
            '<p class="success-sub">Falta só o pagamento para confirmar.</p>' +
            linhasResumo(serv, reserva) +
            '<p class="success-prazo"><i class="far fa-hourglass-half"></i> <span id="txt-prazo"></span></p>' +
            '<p class="success-mail"><i class="far fa-envelope"></i> Enviamos os detalhes para ' + email + '</p>' +
            '<div class="btn-choice-container" id="area-escolha">' +
            '<button type="button" class="btn-pay-now" id="btn-pix"><i class="fa-brands fa-pix"></i> Pagar com PIX</button>' +
            '<a class="btn-pay-card" id="btn-cartao" target="_blank" rel="noopener noreferrer" style="display:none"><i class="far fa-credit-card"></i> Pagar c/ Cartão</a>' +
            '<button type="button" class="btn-pay-later" id="btn-depois">Pagar depois</button>' +
            '</div>' +
            '<div id="area-pix-oculta" style="display:none;" class="pix-container">' +
            '<div class="pix-title"><i class="fa-brands fa-pix"></i> Pague com PIX</div>' +
            '<p class="pix-hint">Abra o app do seu banco e escaneie o QR Code.</p>' +
            '<div class="pix-qr"><img id="pix-qr-img" alt="QR Code PIX" width="190" height="190"></div>' +
            '<div class="pix-divider"><span>ou copie o código</span></div>' +
            '<textarea id="pix-code" class="pix-code-area" rows="4" readonly aria-label="Código PIX copia e cola"></textarea>' +
            '<button type="button" class="btn-copy" id="btn-copiar"><i class="fas fa-copy"></i> Copiar código PIX</button>' +
            '<div class="pix-status"><span class="pix-pulse"></span> Aguardando pagamento... a confirmação é automática.</div>' +
            '<button type="button" class="btn-pay-later" id="btn-depois2">Pagar depois</button>' +
            '</div></div>';
        msg.scrollIntoView({ behavior: 'smooth', block: 'center' });

        // dados vindos do servidor entram só por propriedades (nunca como HTML)
        if (/^[A-Za-z0-9+\/=]+$/.test(r.qrCodeBase64 || '')) $('pix-qr-img').src = 'data:image/png;base64,' + r.qrCodeBase64;
        $('pix-code').value = r.pixCopiaCola || '';
        if (/^https:\/\//.test(r.urlPagamentoCartao || '')) { var c = $('btn-cartao'); c.href = r.urlPagamentoCartao; c.style.display = 'flex'; }

        if (r.pagarAte) {
            var atualizarPrazo = function () { $('txt-prazo').textContent = 'Pague até ' + RodUtil.prazoBR(r.pagarAte) + ' (' + restante(r.pagarAte) + ') para manter a vaga.'; };
            atualizarPrazo(); intervaloPrazo = setInterval(atualizarPrazo, 30000);
        } else $('txt-prazo').textContent = 'Pague para manter a vaga.';

        $('btn-pix').addEventListener('click', function () {
            $('area-escolha').style.display = 'none'; $('area-pix-oculta').style.display = 'block';
            if (r.idPagamento) acompanharPagamento(r.idPagamento, serv, reserva);
        });
        $('btn-copiar').addEventListener('click', function () {
            RodUtil.copiar($('pix-code').value).then(function (ok) { Toast.fire({ icon: ok ? 'success' : 'error', title: ok ? 'Código PIX copiado!' : 'Não consegui copiar. Selecione o código e copie.' }); });
        });
        var depois = function () { pararTimers(); mostrarPagarDepois(serv, reserva, r.pagarAte); };
        $('btn-depois').addEventListener('click', depois); $('btn-depois2').addEventListener('click', depois);
        estado.hora = ''; $('hora-selecionada').value = '';      // o horário agora é nosso: evita o aviso de "acabou de ser reservado"
        carregarHorarios(true);
    }

    // consulta o pagamento a cada poucos segundos; devagar quando a aba está em segundo plano
    function acompanharPagamento(id, serv, reserva) {
        var inicio = Date.now(), ocupado = false;
        intervaloPagamento = setInterval(async function () {
            if (ocupado || document.hidden) return;
            if (Date.now() - inicio > 30 * 60000) { pararTimers(); return; }
            ocupado = true;
            try {
                var res = await RodAuth.fetch(API_URL + '/status-pagamento/' + encodeURIComponent(id));
                var d = await res.json();
                if (d.status === 'approved') { pararTimers(); mostrarConfirmado(serv, reserva); }
            } catch (e) { /* tenta de novo no próximo ciclo */ }
            ocupado = false;
        }, 3000);
    }

    function botoesFinais(reserva) {
        return '<div class="success-links">' +
            '<button type="button" class="btn-link-sec" id="btn-ics"><i class="far fa-calendar-plus"></i> Adicionar à agenda</button>' +
            '<a class="btn-link-sec" href="/meus-agendamentos"><i class="fas fa-calendar-check"></i> Meus cortes</a>' +
            '<a class="btn-link-sec" href="' + RodUtil.linkMapa() + '" target="_blank" rel="noopener noreferrer"><i class="fas fa-location-arrow"></i> Como chegar</a>' +
            '</div>' +
            '<button type="button" class="btn-pay-later" id="btn-novo">Fazer outro agendamento</button>';
    }
    function ligarBotoesFinais(reserva) {
        $('btn-ics').addEventListener('click', function () { RodUtil.baixarIcs(reserva); });
        $('btn-novo').addEventListener('click', function () { window.location.reload(); });
    }

    function mostrarConfirmado(serv, reserva) {
        $('mensagem').innerHTML =
            '<div class="success-container">' +
            '<div class="success-badge"><i class="fas fa-check"></i></div>' +
            '<h3 class="success-title">Pagamento confirmado!</h3>' +
            '<p class="success-sub">Seu horário está garantido. Te esperamos!</p>' +
            linhasResumo(serv, reserva) +
            '<p class="success-mail"><i class="far fa-envelope"></i> Enviamos a confirmação para o seu e-mail.</p>' +
            botoesFinais(reserva) + '</div>';
        ligarBotoesFinais(reserva);
        Toast.fire({ icon: 'success', title: 'Pagamento recebido!' });
    }

    function mostrarPagarDepois(serv, reserva, pagarAte) {
        $('mensagem').innerHTML =
            '<div class="success-container">' +
            '<div class="success-badge pendente"><i class="far fa-hourglass-half"></i></div>' +
            '<h3 class="success-title">Reserva guardada</h3>' +
            '<p class="success-sub">' + (pagarAte ? 'Pague até ' + esc(RodUtil.prazoBR(pagarAte)) + ' em “Meus Cortes” para manter a vaga.' : 'Pague em “Meus Cortes” para manter a vaga.') + '</p>' +
            linhasResumo(serv, reserva) +
            botoesFinais(reserva) + '</div>';
        ligarBotoesFinais(reserva);
    }

    // ---------------------------------------------------------------- navegação: destaque da seção, topo, rolagem
    function iniciarNavegacao() {
        var nav = $('navbar'), topo = $('btn-topo');
        var onScroll = function () {
            nav.classList.toggle('rolou', window.scrollY > 12);
            topo.classList.toggle('visivel', window.scrollY > 700);
        };
        window.addEventListener('scroll', onScroll, { passive: true }); onScroll();
        topo.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }); });

        var links = {};
        document.querySelectorAll('.nav-links a[href^="#"]').forEach(function (a) { links[a.getAttribute('href').slice(1)] = a; });
        if ('IntersectionObserver' in window) {
            var espiao = new IntersectionObserver(function (entradas) {
                entradas.forEach(function (e) {
                    if (!e.isIntersecting) return;
                    Object.keys(links).forEach(function (k) { links[k].classList.toggle('ativo', k === e.target.id); });
                });
            }, { rootMargin: '-45% 0px -50% 0px' });
            ['agendamento', 'sobre', 'precos', 'depoimentos', 'contatos'].forEach(function (id) { var el = $(id); if (el) espiao.observe(el); });
        }
    }

    // ---------------------------------------------------------------- galeria ampliada
    function iniciarGaleria() {
        var cards = Array.prototype.slice.call(document.querySelectorAll('.corte-card'));
        var lb = $('lightbox'), img = $('lb-img'), leg = $('lb-legenda');
        var atual = 0, voltarPara = null, toqueX = null;
        function mostrar(i) {
            atual = (i + cards.length) % cards.length;
            var c = cards[atual], im = c.querySelector('img');
            img.src = im.src; img.alt = im.alt;
            leg.textContent = c.querySelector('h3').textContent + ' — ' + c.querySelector('p').textContent;
        }
        function abrir(i) { voltarPara = document.activeElement; mostrar(i); lb.classList.add('aberto'); document.body.classList.add('sem-rolagem'); lb.querySelector('.lb-fechar').focus(); }
        function fechar() { lb.classList.remove('aberto'); document.body.classList.remove('sem-rolagem'); if (voltarPara) voltarPara.focus(); }
        cards.forEach(function (c, i) {
            c.addEventListener('click', function () { abrir(i); });
            c.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(i); } });
        });
        lb.querySelector('.lb-fechar').addEventListener('click', fechar);
        lb.querySelector('.lb-ant').addEventListener('click', function () { mostrar(atual - 1); });
        lb.querySelector('.lb-prox').addEventListener('click', function () { mostrar(atual + 1); });
        lb.addEventListener('click', function (e) { if (e.target === lb) fechar(); });
        document.addEventListener('keydown', function (e) {
            if (!lb.classList.contains('aberto')) return;
            if (e.key === 'Escape') fechar();
            else if (e.key === 'ArrowLeft') mostrar(atual - 1);
            else if (e.key === 'ArrowRight') mostrar(atual + 1);
            else if (e.key === 'Tab') {                                   // mantém o foco dentro do diálogo
                var f = lb.querySelectorAll('button'); var p = f[0], u = f[f.length - 1];
                if (e.shiftKey && document.activeElement === p) { e.preventDefault(); u.focus(); }
                else if (!e.shiftKey && document.activeElement === u) { e.preventDefault(); p.focus(); }
            }
        });
        lb.addEventListener('touchstart', function (e) { toqueX = e.touches[0].clientX; }, { passive: true });
        lb.addEventListener('touchend', function (e) {
            if (toqueX === null) return;
            var dx = e.changedTouches[0].clientX - toqueX; toqueX = null;
            if (Math.abs(dx) > 50) mostrar(atual + (dx < 0 ? 1 : -1));
        });
    }

    // ---------------------------------------------------------------- sessão
    function iniciarSessao() {
        // a conta do proprietário só usa o painel
        if (RodAuth.papel() === 'owner') { window.location.replace('/admin'); return false; }
        // sem token válido guardado (ex.: sessão antiga), trata como deslogado
        if (!RodAuth.token()) { try { localStorage.removeItem('usuarioNome'); localStorage.removeItem('usuarioEmail'); } catch (e) {} }

        var nome = null, email = null;
        try { nome = localStorage.getItem('usuarioNome'); email = localStorage.getItem('usuarioEmail'); } catch (e) {}
        var logado = Boolean(nome && email);

        $('area-usuario').style.display = logado ? 'flex' : 'none';
        $('logado').style.display = logado ? 'flex' : 'none';
        $('menu-login-item').style.display = logado ? 'none' : 'block';
        document.querySelectorAll('.mobile-logged-item').forEach(function (i) { i.style.display = logado ? 'block' : 'none'; });
        $('btn-meus-cortes').style.display = logado ? 'inline-flex' : 'none';
        $('bloqueio-precos').style.display = logado ? 'none' : 'block';
        $('conteudo-precos').style.display = logado ? 'block' : 'none';
        $('aviso-bloqueio').style.display = logado ? 'none' : 'block';
        $('area-formulario').style.display = logado ? 'block' : 'none';

        if (logado) {
            $('boas-vindas').textContent = 'Olá, ' + nome.split(' ')[0] + '!';
            $('nome').value = nome; $('email').value = email;
            $('nome-exibido').textContent = nome; $('email-exibido').textContent = email;
            $('avatar-mini').textContent = nome.trim().charAt(0).toUpperCase();
        }
        return logado;
    }

    // ---------------------------------------------------------------- revelar seções ao rolar
    function iniciarRevelar() {
        var itens = document.querySelectorAll('.hidden');
        if (!('IntersectionObserver' in window)) { itens.forEach(function (el) { el.classList.add('show'); }); return; }
        var obs = new IntersectionObserver(function (entradas) { entradas.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('show'); obs.unobserve(e.target); } }); }, { threshold: 0.06 });
        itens.forEach(function (el) { obs.observe(el); });
    }

    document.addEventListener('DOMContentLoaded', function () {
        desenharServicos();
        carregarServicos();
        iniciarNavegacao();
        iniciarGaleria();
        iniciarRevelar();
        var logado = iniciarSessao();
        if (logado) {
            desenharDias(); atualizarResumo();
            // acorda o servidor (plano gratuito dorme) enquanto o cliente escolhe o serviço
            fetch(API_URL + '/health').catch(function () {});
            // mantém a disponibilidade fresca: a cada minuto e quando a aba volta ao foco
            setInterval(function () { if (!document.hidden && estado.data && $('form-agendamento').style.display !== 'none') carregarHorarios(true); }, 60000);
            document.addEventListener('visibilitychange', function () { if (!document.hidden && estado.data && $('form-agendamento').style.display !== 'none') carregarHorarios(true); });
        }
    });
})();
