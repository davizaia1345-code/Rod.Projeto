        (function () {
            var API_URL = 'https://rodbarber-api-0jna.onrender.com';
            RodUI.aquecer(API_URL);
            var form = document.getElementById('form-esqueci'), msg = document.getElementById('mensagem'), email = document.getElementById('email');
            email.focus();
            var ultimoEnvio = 0;

            form.addEventListener('submit', async function (e) {
                e.preventDefault();
                var btn = form.querySelector('button[type="submit"]');
                var em = email.value.trim().toLowerCase();
                if (!em) { RodUI.mensagem(msg, 'erro', 'Por favor, digite seu e-mail.'); email.focus(); return; }
                if (!/^\S+@\S+\.\S+$/.test(em)) { RodUI.mensagem(msg, 'erro', 'Esse e-mail não parece válido.'); email.focus(); return; }
                if (Date.now() - ultimoEnvio < 30000) { RodUI.mensagem(msg, 'info', 'Aguarde alguns segundos antes de pedir outro link.'); return; }

                RodUI.carregando(btn, true, 'Enviando...');
                RodUI.mensagem(msg, '', '');
                try {
                    var response = await fetch(API_URL + '/esqueci-senha', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: em }) });
                    var data = await response.json().catch(function () { return {}; });
                    if (response.ok) {
                        ultimoEnvio = Date.now();
                        RodUI.mensagem(msg, 'ok', data.mensagem || 'Se o e-mail estiver cadastrado, você receberá o link.');
                        document.getElementById('dica-spam').hidden = false;
                    } else {
                        RodUI.mensagem(msg, 'erro', data.erro || 'Não foi possível enviar agora.');
                    }
                } catch (err) {
                    RodUI.mensagem(msg, 'erro', 'Sem conexão com o servidor. Tente de novo.');
                }
                RodUI.carregando(btn, false);
            });
        })();
