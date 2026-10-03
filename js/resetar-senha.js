        (function () {
            var API_URL = 'https://rodbarber-api-0jna.onrender.com';
            RodUI.aquecer(API_URL);
            var form = document.getElementById('form-reset'), msg = document.getElementById('mensagem');
            var nova = document.getElementById('novaSenha'), conf = document.getElementById('confirmar');
            RodUI.campoSenha(nova); RodUI.medidorForca(nova); RodUI.campoSenha(conf);

            // o token vem no link do e-mail; tira da barra de endereço para não ficar no histórico
            var token = new URLSearchParams(window.location.search).get('token');
            if (token) { try { history.replaceState(null, '', window.location.pathname); } catch (e) {} }
            if (!token) {
                RodUI.mensagem(msg, 'erro', 'Link inválido ou expirado. Peça outro.');
                document.getElementById('link-novo').hidden = false;
                form.querySelector('button').disabled = true;
            } else nova.focus();

            form.addEventListener('submit', async function (e) {
                e.preventDefault();
                var btn = form.querySelector('button[type="submit"]');
                if (nova.value.length < 8) { RodUI.mensagem(msg, 'erro', 'A senha precisa ter pelo menos 8 caracteres.'); nova.focus(); return; }
                if (nova.value !== conf.value) { RodUI.mensagem(msg, 'erro', 'As senhas não são iguais.'); conf.focus(); return; }

                RodUI.carregando(btn, true, 'Salvando...');
                RodUI.mensagem(msg, '', '');
                try {
                    var response = await fetch(API_URL + '/resetar-senha', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: token, novaSenha: nova.value }) });
                    var data = await response.json().catch(function () { return {}; });
                    if (response.ok) {
                        RodUI.mensagem(msg, 'ok', 'Senha alterada com sucesso! Redirecionando para o login...');
                        setTimeout(function () { window.location.href = '/login'; }, 2200);
                    } else {
                        RodUI.mensagem(msg, 'erro', data.erro || 'Não foi possível alterar a senha.');
                        document.getElementById('link-novo').hidden = false;
                        RodUI.carregando(btn, false);
                    }
                } catch (err) {
                    RodUI.mensagem(msg, 'erro', 'Não foi possível conectar. Tente de novo.');
                    RodUI.carregando(btn, false);
                }
            });
        })();
