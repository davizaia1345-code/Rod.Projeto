// Funções compartilhadas pelas páginas (datas em Brasília, calendário .ics, copiar, links)
(function () {
    var TZ = 'America/Sao_Paulo';
    var ENDERECO = 'Rua Mário Ferraz de Souza, 889, Cidade Tiradentes, São Paulo - SP';
    var WHATS = '5511949411527';
    var DURACOES = { 'Corte Masculino': 40, 'Barba Completa': 20, 'Corte + Barba': 60, 'Progressiva + Corte': 120, 'Luzes + Corte': 90, 'Sobrancelha': 10 };

    function dois(n) { return (n < 10 ? '0' : '') + n; }

    // "AAAA-MM-DD" de hoje em Brasília (toISOString usaria UTC e viraria o dia às 21h)
    function hojeSP(deslocamentoDias) {
        var p = {};
        new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
            .formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; });
        var d = new Date(Date.UTC(+p.year, +p.month - 1, +p.day + (deslocamentoDias || 0)));
        return d.getUTCFullYear() + '-' + dois(d.getUTCMonth() + 1) + '-' + dois(d.getUTCDate());
    }

    function dataBR(iso) {
        var p = String(iso || '').split('-');
        return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : '--/--/----';
    }

    // data local ao meio-dia (evita virar o dia por fuso) para formatar nomes de dia
    function dataLocal(iso) { return new Date(iso + 'T12:00:00'); }

    function diaDaSemana(iso, estilo) {
        return dataLocal(iso).toLocaleDateString('pt-BR', { weekday: estilo || 'long' }).replace('.', '');
    }

    function dataExtenso(iso) {
        return dataLocal(iso).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
    }

    // "dentro de 2 dias", "amanhã às 14:00"...
    function quando(iso, hora) {
        var hoje = hojeSP(0);
        if (iso === hoje) return 'hoje às ' + hora;
        if (iso === hojeSP(1)) return 'amanhã às ' + hora;
        var dias = Math.round((Date.parse(iso + 'T00:00:00Z') - Date.parse(hoje + 'T00:00:00Z')) / 86400000);
        if (dias < 0) return dataBR(iso) + ' às ' + hora;
        return 'em ' + dias + ' dias (' + diaDaSemana(iso, 'long') + ') às ' + hora;
    }

    // data+hora de Brasília (UTC-3 fixo, sem horário de verão) -> Date
    function instante(iso, hora) { return new Date(iso + 'T' + hora + ':00-03:00'); }

    function jaPassou(iso, hora) { return instante(iso, hora).getTime() < Date.now(); }

    function ymdhmsUTC(d) {
        return d.getUTCFullYear() + dois(d.getUTCMonth() + 1) + dois(d.getUTCDate()) + 'T' + dois(d.getUTCHours()) + dois(d.getUTCMinutes()) + dois(d.getUTCSeconds()) + 'Z';
    }

    function escIcs(t) { return String(t).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n'); }

    // baixa um arquivo .ics (abre no calendário do celular/computador)
    function baixarIcs(ag) {
        var ini = instante(ag.data, ag.hora);
        var fim = new Date(ini.getTime() + (DURACOES[ag.servico] || 40) * 60000);
        var linhas = [
            'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//RodBarber//Agendamento//PT-BR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
            'BEGIN:VEVENT',
            'UID:' + (ag.id || (ag.data + ag.hora).replace(/\W/g, '')) + '@rodbarber',
            'DTSTAMP:' + ymdhmsUTC(new Date()),
            'DTSTART:' + ymdhmsUTC(ini), 'DTEND:' + ymdhmsUTC(fim),
            'SUMMARY:' + escIcs(ag.servico + ' - Barbearia do Rod'),
            'LOCATION:' + escIcs(ENDERECO),
            'DESCRIPTION:' + escIcs('Agendamento na Barbearia do Rod. Chegue com alguns minutos de antecedência.'),
            'BEGIN:VALARM', 'TRIGGER:-PT1H', 'ACTION:DISPLAY', 'DESCRIPTION:Seu horário na barbearia é daqui a 1 hora', 'END:VALARM',
            'END:VEVENT', 'END:VCALENDAR'
        ];
        var blob = new Blob([linhas.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'corte-rodbarber.ics';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    }

    function copiar(texto) {
        if (navigator.clipboard && window.isSecureContext) {
            return navigator.clipboard.writeText(texto).then(function () { return true; }, function () { return copiarAntigo(texto); });
        }
        return Promise.resolve(copiarAntigo(texto));
    }
    function copiarAntigo(texto) {
        try {
            var t = document.createElement('textarea');
            t.value = texto; t.setAttribute('readonly', ''); t.style.cssText = 'position:fixed;top:-1000px;opacity:0';
            document.body.appendChild(t); t.select(); t.setSelectionRange(0, 99999);
            var ok = document.execCommand('copy'); t.remove(); return ok;
        } catch (e) { return false; }
    }

    function linkWhats(msg) { return 'https://api.whatsapp.com/send?phone=' + WHATS + '&text=' + encodeURIComponent(msg || 'Olá! Gostaria de agendar um corte.'); }
    function linkMapa() { return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(ENDERECO); }
    function brl(v) { return 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

    // "dd/mm às HH:MM" no horário de Brasília
    function prazoBR(isoInstante) {
        return new Date(isoInstante).toLocaleString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(', ', ' às ');
    }

    window.RodUtil = {
        endereco: ENDERECO, duracoes: DURACOES, hojeSP: hojeSP, dataBR: dataBR, diaDaSemana: diaDaSemana, dataExtenso: dataExtenso,
        quando: quando, instante: instante, jaPassou: jaPassou, baixarIcs: baixarIcs, copiar: copiar,
        linkWhats: linkWhats, linkMapa: linkMapa, brl: brl, prazoBR: prazoBR
    };
})();
