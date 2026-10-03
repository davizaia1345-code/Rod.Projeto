// Liga botões e formulários às funções da página sem usar atributos onclick/onsubmit
// (permite uma política de segurança sem 'unsafe-inline' em scripts).
//   data-click="funcao" [data-arg="valor"]   data-change="funcao"   data-submit="funcao"
(function () {
    function achar(caminho) {
        var partes = String(caminho).split('.'), alvo = window;
        for (var i = 0; i < partes.length - 1; i++) { alvo = alvo && alvo[partes[i]]; }
        var nome = partes[partes.length - 1];
        return alvo && typeof alvo[nome] === 'function' ? { fn: alvo[nome], dono: alvo } : null;
    }
    function ligar(tipo, atributo) {
        document.addEventListener(tipo, function (ev) {
            var el = ev.target.closest && ev.target.closest('[' + atributo + ']');
            if (!el) return;
            var alvo = achar(el.getAttribute(atributo));
            if (!alvo) return;
            if (tipo === 'click' && el.tagName === 'A' && el.getAttribute('href') === '#') ev.preventDefault();
            var arg = el.hasAttribute('data-arg') ? el.getAttribute('data-arg') : undefined;
            alvo.fn.call(alvo.dono, tipo === 'submit' ? ev : arg, ev, el);
        });
    }
    ligar('click', 'data-click');
    ligar('change', 'data-change');
    ligar('submit', 'data-submit');
})();
