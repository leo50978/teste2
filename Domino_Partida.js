/* 
    Domino ThreeJS creado por Josep Antoni Bover Comas el 19/01/2019

        Objeto para la partida en curso
*/

var Domino_Partida = function() {
    this.JugadorActual      = 0;
    this.TurnoActual        = 0;
    this.Mano               = 0;
    this.FichaIzquierda     = { };
    this.FichaDerecha       = { };

    this.Pasado             = 0;
    this.Ficha              = [];
    this.TiempoTurno        = 1250;
    this.TimerMsg           = [ 0, 0, 0, 0 ];
    this.ManoTerminada      = false;
    this.ContinuandoPartida = false;

    this.Multijugador       = false;
    this.LocalSeat          = 0;
    this.EsHost             = false;
    this.SeatsHumanos       = [0];
    this.EsperandoPublicar  = false;
    this.SiguienteAccionSeq = 0;
    this.AccionesPendientes = {};
    this.ReintentosAccion   = {};
    this.ReintentosTurno    = {};
    this.ModoRehidratacion  = false;
    this.TimerReintentoTurno = 0;
    this.TimerEsperaFinMano = 0;
    this.TimerCuentaAtrasTurnoLocal = 0;
    this.DeadlineTurnoHumanoLocalMs = 0;
    this.TimerBotLocal = 0;
    this.TokenBotLocal = 0;
    this.AnimacionInicioActiva = false;
    this.RAFAnimacionInicio = 0;
    this.ClaveAnimacionInicio = "";
    this.DuracionAnimacionInicio = 5000;
    this.BrassageAnimacionInicio = 1800;
    this.RepartoAnimacionInicio = 2200;
    this.RetrasoRepartoAnimacionInicio = 46;
    this.ViajeRepartoAnimacionInicio = 310;
    this.DuracionTurnoHumanoLocalMs = 30000;

    this.Opciones = new Domino_Opciones;

    this.DebugLog = function(Etiqueta, Datos) {
        try {
            var Payload = Object.assign({
                ts: new Date().toISOString(),
                turnoActual: this.TurnoActual,
                jugadorActual: this.JugadorActual,
                siguienteAccionSeq: this.SiguienteAccionSeq,
                modoRehidratacion: this.ModoRehidratacion,
                localSeat: this.LocalSeat,
                esHost: this.EsHost
            }, Datos || { });
            console.log("[DOMINO_DEBUG] " + Etiqueta + " " + JSON.stringify(Payload), Payload);
        }
        catch (_) {
        }
    };

    this.CancelarReintentoTurno = function() {
        if (this.TimerReintentoTurno !== 0) {
            clearTimeout(this.TimerReintentoTurno);
            this.TimerReintentoTurno = 0;
        }
    };

    this.CancelarEsperaFinMano = function() {
        if (this.TimerEsperaFinMano !== 0) {
            clearTimeout(this.TimerEsperaFinMano);
            this.TimerEsperaFinMano = 0;
        }
    };

    this.ActualizarVisualTimerTurno = function(Texto) {
        var TextoSeguro = (typeof(Texto) === "string" && Texto !== "") ? Texto : "--";
        var EsUrgente = false;
        var MatchSeg = /^(\d+)s$/.exec(TextoSeguro);
        if (MatchSeg) {
            EsUrgente = parseInt(MatchSeg[1], 10) <= 5;
        }

        var TimerNode = document.getElementById("TurnTimer");
        if (TimerNode) {
            TimerNode.innerHTML = TextoSeguro;
            TimerNode.setAttribute("Urgent", EsUrgente ? "true" : "false");
        }

        var HudTimerNode = document.getElementById("LocalTurnTimer");
        if (HudTimerNode) {
            HudTimerNode.textContent = TextoSeguro;
            HudTimerNode.setAttribute("Urgent", EsUrgente ? "true" : "false");
        }
    };

    this.CancelarCuentaAtrasTurnoLocal = function() {
        if (this.TimerCuentaAtrasTurnoLocal !== 0) {
            clearInterval(this.TimerCuentaAtrasTurnoLocal);
            this.TimerCuentaAtrasTurnoLocal = 0;
        }
        this.DeadlineTurnoHumanoLocalMs = 0;
        this.ActualizarVisualTimerTurno("--");
    };

    this.CancelarTurnoBotLocalPendiente = function() {
        if (this.TimerBotLocal !== 0) {
            clearTimeout(this.TimerBotLocal);
            this.TimerBotLocal = 0;
        }
        this.TokenBotLocal++;
    };

    this.CancelarTemporizadoresTurnoLocal = function() {
        this.CancelarCuentaAtrasTurnoLocal();
        this.CancelarTurnoBotLocalPendiente();
    };

    this.ObtenerPerfilBotLocal = function(Seat) {
        var Dificultad = this.ObtenerDificultadBotLocal();
        if (Dificultad !== "ultra") return Dificultad;
        var SeatBot = (typeof(Seat) === "number") ? Seat : this.JugadorActual;
        if (SeatBot === this.LocalSeat) return "ultra";
        if (this.EsAliadoBotLocal(SeatBot, this.LocalSeat) === true) return "ally_nerfed";
        return "ultra";
    };

    this.ObtenerDelayBotLocalMs = function(EsApertura, Seat) {
        var Dificultad = this.ObtenerPerfilBotLocal(Seat);
        var Minimo = 2400;
        var Maximo = 5200;
        if (Dificultad === "userpro") {
            Minimo = (EsApertura === true) ? 2600 : 2500;
            Maximo = (EsApertura === true) ? 5200 : 5400;
        }
        else if (Dificultad === "ally_nerfed") {
            Minimo = (EsApertura === true) ? 2800 : 2600;
            Maximo = (EsApertura === true) ? 5600 : 5800;
        }
        else if (Dificultad === "ultra") {
            Minimo = (EsApertura === true) ? 650 : 520;
            Maximo = (EsApertura === true) ? 1350 : 1550;
        }
        return Minimo + Math.floor(Math.random() * ((Maximo - Minimo) + 1));
    };

    this.NormalizarDificultadBotLocal = function(Valor) {
        var Nivel = String(Valor || "").trim().toLowerCase();
        if (Nivel === "ultra" || Nivel === "expert") return "ultra";
        if (Nivel === "userpro" || Nivel === "amateur") return "userpro";
        return "userpro";
    };

    this.ObtenerDificultadBotLocal = function() {
        var S = (typeof(window.GameSession) !== "undefined") ? window.GameSession : null;
        return this.NormalizarDificultadBotLocal(S && S.botDifficulty);
    };

    this.ContarOpcionesRestantesBotLocal = function(Seat, PosFicha, ValorIzquierda, ValorDerecha) {
        var Coincidencias = 0;
        var Ini = this.SeatInicio(Seat);
        for (var i = 0; i < 7; i++) {
            var idx = Ini + i;
            if (idx === PosFicha) continue;
            if (!this.Ficha[idx] || this.Ficha[idx].Colocada === true) continue;
            var Valores = this.Ficha[idx].Valores;
            if (Valores[0] === ValorIzquierda || Valores[1] === ValorIzquierda || Valores[0] === ValorDerecha || Valores[1] === ValorDerecha) {
                Coincidencias++;
            }
        }
        return Coincidencias;
    };

    this.EsAliadoBotLocal = function(SeatA, SeatB) {
        if (typeof(SeatA) !== "number" || typeof(SeatB) !== "number") return false;
        return ((SeatA % 2) === (SeatB % 2));
    };

    this.ContarPipsRestantesSeatBotLocal = function(Seat, PosFichaExcluida) {
        var Total = 0;
        var Ini = this.SeatInicio(Seat);
        for (var i = 0; i < 7; i++) {
            var idx = Ini + i;
            if (idx === PosFichaExcluida) continue;
            if (!this.Ficha[idx] || this.Ficha[idx].Colocada === true) continue;
            Total += (this.Ficha[idx].Valores[0] + this.Ficha[idx].Valores[1]);
        }
        return Total;
    };

    this.ContarFichasRestantesSeatBotLocal = function(Seat, PosFichaExcluida) {
        var Total = 0;
        var Ini = this.SeatInicio(Seat);
        for (var i = 0; i < 7; i++) {
            var idx = Ini + i;
            if (idx === PosFichaExcluida) continue;
            if (!this.Ficha[idx] || this.Ficha[idx].Colocada === true) continue;
            Total++;
        }
        return Total;
    };

    this.ContarSoporteValoresSeatBotLocal = function(Seat, PosFichaExcluida, ValorIzquierda, ValorDerecha) {
        var Total = 0;
        var Ini = this.SeatInicio(Seat);
        for (var i = 0; i < 7; i++) {
            var idx = Ini + i;
            if (idx === PosFichaExcluida) continue;
            if (!this.Ficha[idx] || this.Ficha[idx].Colocada === true) continue;
            var Valores = this.Ficha[idx].Valores;
            if (Valores[0] === ValorIzquierda || Valores[1] === ValorIzquierda) Total++;
            if (ValorDerecha !== ValorIzquierda && (Valores[0] === ValorDerecha || Valores[1] === ValorDerecha)) Total++;
        }
        return Total;
    };

    this.EvaluarMovimientoBotLocal = function(Seat, Movimiento) {
        if (!Movimiento || typeof(Movimiento.Pos) !== "number") return Number.NEGATIVE_INFINITY;
        var FichaBot = this.Ficha[Movimiento.Pos];
        if (!FichaBot || FichaBot.Colocada === true) return Number.NEGATIVE_INFINITY;

        var IzquierdaActual = this.FichaIzquierda.ValorLibre();
        var DerechaActual = this.FichaDerecha.ValorLibre();
        var V0 = FichaBot.Valores[0];
        var V1 = FichaBot.Valores[1];
        var ValorIzquierda = IzquierdaActual;
        var ValorDerecha = DerechaActual;

        if (Movimiento.Rama === "izquierda") {
            if (V0 === IzquierdaActual) ValorIzquierda = V1;
            else if (V1 === IzquierdaActual) ValorIzquierda = V0;
        }
        else {
            if (V0 === DerechaActual) ValorDerecha = V1;
            else if (V1 === DerechaActual) ValorDerecha = V0;
        }

        var Pips = V0 + V1;
        var EsDoble = (V0 === V1) ? 1 : 0;
        var FuturasCoincidencias = this.ContarOpcionesRestantesBotLocal(Seat, Movimiento.Pos, ValorIzquierda, ValorDerecha);
        var MantieneDiversidad = (ValorIzquierda !== ValorDerecha) ? 1 : 0;
        var CierraExtremoAlto = ((Movimiento.Rama === "izquierda" ? IzquierdaActual : DerechaActual) >= 5) ? 1 : 0;

        return (Pips * 4) + (FuturasCoincidencias * 6) + (MantieneDiversidad * 3) + (EsDoble * 2) + CierraExtremoAlto;
    };

    this.EvaluarMovimientoUltraBotLocal = function(Seat, Movimiento) {
        if (!Movimiento || typeof(Movimiento.Pos) !== "number") return Number.NEGATIVE_INFINITY;
        var FichaBot = this.Ficha[Movimiento.Pos];
        if (!FichaBot || FichaBot.Colocada === true) return Number.NEGATIVE_INFINITY;

        var IzquierdaActual = this.FichaIzquierda.ValorLibre();
        var DerechaActual = this.FichaDerecha.ValorLibre();
        var V0 = FichaBot.Valores[0];
        var V1 = FichaBot.Valores[1];
        var ValorIzquierda = IzquierdaActual;
        var ValorDerecha = DerechaActual;

        if (Movimiento.Rama === "izquierda") {
            if (V0 === IzquierdaActual) ValorIzquierda = V1;
            else if (V1 === IzquierdaActual) ValorIzquierda = V0;
        }
        else {
            if (V0 === DerechaActual) ValorDerecha = V1;
            else if (V1 === DerechaActual) ValorDerecha = V0;
        }

        var FichasRestantes = this.ContarFichasRestantesSeatBotLocal(Seat, Movimiento.Pos);
        if (FichasRestantes <= 0) return 1000000;

        var Base = this.EvaluarMovimientoBotLocal(Seat, Movimiento);
        var SiguenteSeat = (Seat + 1) % 4;
        var AllySeat = (Seat + 2) % 4;
        var OppositeSeat = (Seat + 3) % 4;

        var SelfOptions = this.ContarOpcionesRestantesBotLocal(Seat, Movimiento.Pos, ValorIzquierda, ValorDerecha);
        var AllyOptions = this.ContarOpcionesRestantesBotLocal(AllySeat, -1, ValorIzquierda, ValorDerecha);
        var NextOpponentOptions = this.ContarOpcionesRestantesBotLocal(SiguenteSeat, -1, ValorIzquierda, ValorDerecha);
        var OtherOpponentOptions = this.ContarOpcionesRestantesBotLocal(OppositeSeat, -1, ValorIzquierda, ValorDerecha);

        var TeamSupport = this.ContarSoporteValoresSeatBotLocal(Seat, Movimiento.Pos, ValorIzquierda, ValorDerecha)
            + this.ContarSoporteValoresSeatBotLocal(AllySeat, -1, ValorIzquierda, ValorDerecha);
        var RivalSupport = this.ContarSoporteValoresSeatBotLocal(SiguenteSeat, -1, ValorIzquierda, ValorDerecha)
            + this.ContarSoporteValoresSeatBotLocal(OppositeSeat, -1, ValorIzquierda, ValorDerecha);

        var TeamPipsLeft = this.ContarPipsRestantesSeatBotLocal(Seat, Movimiento.Pos)
            + this.ContarPipsRestantesSeatBotLocal(AllySeat, -1);
        var RivalPipsLeft = this.ContarPipsRestantesSeatBotLocal(SiguenteSeat, -1)
            + this.ContarPipsRestantesSeatBotLocal(OppositeSeat, -1);

        var NextOpponentBlocked = (NextOpponentOptions === 0) ? 1 : 0;
        var BothOpponentsBlocked = (NextOpponentOptions === 0 && OtherOpponentOptions === 0) ? 1 : 0;
        var TeamDry = (SelfOptions + AllyOptions) === 0 ? 1 : 0;
        var KeepsTwoEnds = (ValorIzquierda !== ValorDerecha) ? 1 : 0;
        var HighPips = V0 + V1;

        return Base
            + (SelfOptions * 24)
            + (AllyOptions * 11)
            - (NextOpponentOptions * 32)
            - (OtherOpponentOptions * 18)
            + ((TeamSupport - RivalSupport) * 14)
            + (RivalPipsLeft * 0.45)
            - (TeamPipsLeft * 1.15)
            + (NextOpponentBlocked * 140)
            + (BothOpponentsBlocked * 90)
            - (TeamDry * 180)
            + (KeepsTwoEnds * 10)
            + (HighPips * 5);
    };

    this.ElegirMovimientoBotLocal = function(Seat, PosibilidadesBot) {
        if (!Array.isArray(PosibilidadesBot) || PosibilidadesBot.length <= 0) return null;
        var Dificultad = this.ObtenerPerfilBotLocal(Seat);
        if (Dificultad === "userpro") {
            return PosibilidadesBot[Math.floor(Math.random() * PosibilidadesBot.length)] || PosibilidadesBot[0];
        }

        var Evaluadas = PosibilidadesBot.map(function(Mov) {
            return {
                move: Mov,
                score: (Dificultad === "ultra")
                    ? this.EvaluarMovimientoUltraBotLocal(Seat, Mov)
                    : this.EvaluarMovimientoBotLocal(Seat, Mov)
            };
        }.bind(this)).sort(function(A, B) {
            return B.score - A.score;
        });

        if (Dificultad === "ultra") {
            return Evaluadas[0].move;
        }
        if (Dificultad === "ally_nerfed") {
            var InicioPeorTercio = Math.max(0, Evaluadas.length - Math.max(1, Math.ceil(Evaluadas.length * 0.35)));
            var OpcionesFaibles = Evaluadas.slice(InicioPeorTercio);
            var Candidatos = (OpcionesFaibles.length > 0) ? OpcionesFaibles : Evaluadas.slice(-1);
            return Candidatos[Math.floor(Math.random() * Candidatos.length)].move;
        }
        return PosibilidadesBot[Math.floor(Math.random() * PosibilidadesBot.length)] || PosibilidadesBot[0];
    };

    this.IniciarCuentaAtrasTurnoHumanoLocal = function() {
        this.CancelarCuentaAtrasTurnoLocal();
        if (this.Multijugador === true || this.ManoTerminada === true || this.JugadorActual !== this.LocalSeat) return;
        this.DeadlineTurnoHumanoLocalMs = Date.now() + this.DuracionTurnoHumanoLocalMs;
        var Actualizar = function() {
            var RestanteMs = Math.max(0, this.DeadlineTurnoHumanoLocalMs - Date.now());
            var RestanteSeg = Math.max(0, Math.ceil(RestanteMs / 1000));
            this.ActualizarVisualTimerTurno(String(RestanteSeg) + "s");
            if (RestanteMs > 0) return;
            this.CancelarCuentaAtrasTurnoLocal();
            this.JugarTurnoHumanoLocalPorTimeout();
        }.bind(this);
        Actualizar();
        this.TimerCuentaAtrasTurnoLocal = setInterval(Actualizar, 250);
    };

    this.ProgramarTurnoBotLocal = function(Seat, EsApertura) {
        this.CancelarTurnoBotLocalPendiente();
        if (this.Multijugador === true || this.ManoTerminada === true) return;
        var SeatBot = (typeof(Seat) === "number") ? Seat : this.JugadorActual;
        var Token = ++this.TokenBotLocal;
        var DelayMs = this.ObtenerDelayBotLocalMs(EsApertura === true, SeatBot);
        this.ActualizarVisualTimerTurno("...");
        this.TimerBotLocal = setTimeout(function() {
            this.TimerBotLocal = 0;
            if (Token !== this.TokenBotLocal) return;
            if (this.ManoTerminada === true || this.Multijugador === true) return;
            if (this.JugadorActual !== SeatBot) return;

            if (EsApertura === true) {
                var Ini = this.SeatInicio(SeatBot);
                for (var j = 0; j < 7; j++) {
                    var idx66 = Ini + j;
                    if (this.Ficha[idx66].Colocada === false && this.Ficha[idx66].Valores[0] === 6 && this.Ficha[idx66].Valores[1] === 6) {
                        this.Ficha[idx66].Colocar(false);
                        this.MostrarMensaje(SeatBot,
                            "<span>" + this.Opciones.NombreJugador[SeatBot] + "</span>" +
                            "<span data-idioma-en=' throws : ' data-idioma-cat=' tira : ' data-idioma-es=' tira : '></span>" +
                            "<img src='./Domino.svg#Ficha_6-6' />");
                        if (this.ComprobarManoTerminada(SeatBot) === true) return;
                        setTimeout(function() { this.Turno(); }.bind(this), this.TiempoTurno);
                        return;
                    }
                }
                return;
            }

            var PosibilidadesBot = this.PosibilidadesJugador(SeatBot);
            if (PosibilidadesBot.length > 0) {
                this.Pasado = 0;
                var BotMove = this.ElegirMovimientoBotLocal(SeatBot, PosibilidadesBot) || PosibilidadesBot[0];
                this.Ficha[BotMove.Pos].Colocar((BotMove.Rama === "izquierda") ? this.FichaIzquierda : this.FichaDerecha);
                this.MostrarMensaje(SeatBot,
                    "<span>" + this.Opciones.NombreJugador[SeatBot] + "</span>" +
                    "<span data-idioma-en=' throws : ' data-idioma-cat=' tira : ' data-idioma-es=' tira : '></span>" +
                    "<img src='./Domino.svg#Ficha_" + this.Ficha[BotMove.Pos].Valores[1] + "-" + this.Ficha[BotMove.Pos].Valores[0] +"' />");
                if (this.ComprobarManoTerminada(SeatBot) === true) return;
                setTimeout(function() { this.Turno(); }.bind(this), this.TiempoTurno);
                return;
            }

            this.MostrarMensaje(SeatBot,
                "<span>" + this.Opciones.NombreJugador[SeatBot] + "</span>" +
                "<span data-idioma-en='Pass...' data-idioma-cat='Pasa...' data-idioma-es='Pasa...'></span>", "rojo");
            this.Pasado++;
            this.TurnoActual++;
            this.JugadorActual++;
            if (this.JugadorActual > 3) this.JugadorActual = 0;
            if (this.ComprobarManoTerminada() === true) return;
            setTimeout(function() { this.Turno(); }.bind(this), this.TiempoTurno);
        }.bind(this), DelayMs);
    };

    this.JugarTurnoHumanoLocalPorTimeout = function() {
        if (this.Multijugador === true || this.ManoTerminada === true) return false;
        if (this.JugadorActual !== this.LocalSeat) return false;

        if (this.TurnoActual === 0) {
            var Inicio = this.SeatInicio(this.LocalSeat);
            for (var i = 0; i < 7; i++) {
                var idx66 = Inicio + i;
                if (this.Ficha[idx66].Colocada === false && this.Ficha[idx66].Valores[0] === 6 && this.Ficha[idx66].Valores[1] === 6) {
                    this.Ficha[idx66].Colocar(false, true);
                    this.MostrarMensaje(this.LocalSeat,
                        "<span>" + this.Opciones.NombreJugador[this.LocalSeat] + "</span>" +
                        "<span data-idioma-en=' auto plays : ' data-idioma-cat=' juga automÃ ticament : ' data-idioma-es=' juega automaticamente : '></span>" +
                        "<img src='./Domino.svg#Ficha_6-6' />", "negro");
                    if (this.ComprobarManoTerminada(this.LocalSeat) === true) return true;
                    this.OcultarAyuda();
                    setTimeout(function() { this.Turno(); }.bind(this), this.TiempoTurno);
                    return true;
                }
            }
            return false;
        }

        if (this.TableroListo() === false) return false;
        var Posibilidades = this.PosibilidadesJugador(this.LocalSeat);
        if (Posibilidades.length <= 0) return false;
        var AutoMove = Posibilidades[Math.floor(Math.random() * Posibilidades.length)] || Posibilidades[0];
        var Rama = (AutoMove.Rama === "izquierda") ? this.FichaIzquierda : this.FichaDerecha;
        this.Ficha[AutoMove.Pos].Colocar(Rama, true);
        this.MostrarMensaje(this.LocalSeat,
            "<span>" + this.Opciones.NombreJugador[this.LocalSeat] + "</span>" +
            "<span data-idioma-en=' auto plays : ' data-idioma-cat=' juga automÃ ticament : ' data-idioma-es=' juega automaticamente : '></span>" +
            "<img src='./Domino.svg#Ficha_" + this.Ficha[AutoMove.Pos].Valores[1] + "-" + this.Ficha[AutoMove.Pos].Valores[0] +"' />", "negro");
        if (this.ComprobarManoTerminada(this.LocalSeat) === true) return true;
        this.OcultarAyuda();
        setTimeout(function() { this.Turno(); }.bind(this), this.TiempoTurno);
        return true;
    };

    this.EsperarFinAnimacionMano = function(Funcion, Etiqueta, Datos, VerificarListo) {
        if (typeof(Funcion) !== "function") return;
        var Listo = false;
        if (typeof(VerificarListo) === "function") {
            try {
                Listo = (VerificarListo() === true);
            } catch (_) {
                Listo = false;
            }
        } else {
            Listo = (this.HayAnimacionColocarActiva() === false);
        }
        if (Listo === true) {
            this.CancelarEsperaFinMano();
            Funcion();
            return;
        }
        if (this.TimerEsperaFinMano !== 0) return;
        this.DebugLog(Etiqueta || "FinMano:waitAnimation", Object.assign({
            hayAnimacionColocar: this.HayAnimacionColocarActiva(),
            siguienteAccionSeq: this.SiguienteAccionSeq
        }, Datos || { }));
        this.TimerEsperaFinMano = setTimeout(function() {
            this.TimerEsperaFinMano = 0;
            this.EsperarFinAnimacionMano(Funcion, Etiqueta, Datos, VerificarListo);
        }.bind(this), 90);
    };

    this.ProgramarReintentoTurno = function(DelayMs, Etiqueta, Datos) {
        var Delay = (typeof(DelayMs) === "number" && DelayMs > 0) ? DelayMs : 120;
        if (this.TimerReintentoTurno !== 0) return;
        this.DebugLog(Etiqueta || "Turno:retryScheduled", Object.assign({
            delayMs: Delay
        }, Datos || { }));
        this.TimerReintentoTurno = setTimeout(function() {
            this.TimerReintentoTurno = 0;
            this.Turno();
        }.bind(this), Delay);
    };

    this.CrearFichas = function() {
        if (this.Ficha.length !== 0) {
            for (var i = 0; i < 28; i++) {
                Domino.Escena.remove(this.Ficha[i].Ficha);
            }
        }
        this.Ficha = [];

        var Pos = [ -4.5, -5.0 ];
        for (var j = 0; j < 28; j++) {
            this.Ficha[j] = new Domino_Ficha();
            this.Ficha[j].Crear(j);
            Domino.Escena.add(this.Ficha[j].Ficha);
            this.Ficha[j].Ficha.position.set(Pos[0], 0.0, Pos[1]);
            this.Ficha[j].RotarV();
            Pos[0] += 1.5;
            if (Pos[0] > 5.0) {
                Pos[0] = -4.5;
                Pos[1] += 2.5;
            }
        }
    };

    this.JugadorInicio = function() {
        for (var seat = 0; seat < 4; seat++) {
            var ini = this.SeatInicio(seat);
            for (var j = 0; j < 7; j++) {
                if (this.Ficha[ini + j].Valores[0] === 6 && this.Ficha[ini + j].Valores[1] === 6) {
                    return seat;
                }
            }
        }
        return 0;
    };

    this.SeatInicio = function(seat) {
        return seat * 7;
    };

    this.VisualSeat = function(seat) {
        if (this.Multijugador === false) return seat;
        return (seat - this.LocalSeat + 4) % 4;
    };

    this.EsSeatHumano = function(seat) {
        if (this.Multijugador === false) return (seat === 0);
        return this.SeatsHumanos.indexOf(seat) !== -1;
    };

    this.EsTurnoHumanoLocal = function() {
        return this.EsSeatHumano(this.JugadorActual) && this.JugadorActual === this.LocalSeat;
    };

    this.EsTurnoHumanoRemoto = function() {
        return this.EsSeatHumano(this.JugadorActual) && this.JugadorActual !== this.LocalSeat;
    };

    this.CalcularFuerzaFichaUltraLocal = function(FichaDomino) {
        if (!FichaDomino || !Array.isArray(FichaDomino.Valores)) return Number.NEGATIVE_INFINITY;
        var V0 = Number(FichaDomino.Valores[0] || 0);
        var V1 = Number(FichaDomino.Valores[1] || 0);
        var Pips = V0 + V1;
        var EsDoble = (V0 === V1) ? 1 : 0;
        var Altos = (V0 >= 4 ? 1 : 0) + (V1 >= 4 ? 1 : 0);
        var Bajos = (V0 <= 1 ? 1 : 0) + (V1 <= 1 ? 1 : 0);
        var Ceros = (V0 === 0 ? 1 : 0) + (V1 === 0 ? 1 : 0);
        var TieneSeis = (V0 === 6 || V1 === 6) ? 1 : 0;
        var TieneCinco = (V0 === 5 || V1 === 5) ? 1 : 0;
        return (Pips * 10) + (EsDoble * 18) + (Altos * 8) + (TieneSeis * 8) + (TieneCinco * 4) - (Bajos * 6) - (Ceros * 7);
    };

    this.CalcularCargaFichaUltraLocal = function(FichaDomino) {
        if (!FichaDomino || !Array.isArray(FichaDomino.Valores)) return Number.NEGATIVE_INFINITY;
        var V0 = Number(FichaDomino.Valores[0] || 0);
        var V1 = Number(FichaDomino.Valores[1] || 0);
        var Pips = V0 + V1;
        var EsDoble = (V0 === V1) ? 1 : 0;
        var Altos = (V0 >= 4 ? 1 : 0) + (V1 >= 4 ? 1 : 0);
        var Bajos = (V0 <= 1 ? 1 : 0) + (V1 <= 1 ? 1 : 0);
        var Ceros = (V0 === 0 ? 1 : 0) + (V1 === 0 ? 1 : 0);
        var Apertura = (V0 === 6 && V1 === 6) ? 1 : 0;
        var Separacion = Math.abs(V0 - V1);
        return (Pips * 9) + (Ceros * 14) + (Bajos * 7) + (Separacion * 4) - (Altos * 4) - (EsDoble * 5) - (Apertura * 40);
    };

    this.BarajarListaUltraLocal = function(Lista) {
        var Copia = Array.isArray(Lista) ? Lista.slice() : [];
        for (var i = Copia.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var Tmp = Copia[i];
            Copia[i] = Copia[j];
            Copia[j] = Tmp;
        }
        return Copia;
    };

    this.ConstruirOrdenFichasUltraLocal = function() {
        var Pool = [];
        for (var i = 0; i < this.Ficha.length; i++) {
            Pool.push(this.Ficha[i]);
        }

        var SacarIndice = function(Lista, Predicado) {
            for (var p = 0; p < Lista.length; p++) {
                if (Predicado(Lista[p]) === true) return p;
            }
            return -1;
        };

        var Oponentes = [ [], [] ];
        var CampoJugador = [];
        var idx66 = SacarIndice(Pool, function(FichaDomino) {
            return FichaDomino && FichaDomino.Valores && FichaDomino.Valores[0] === 6 && FichaDomino.Valores[1] === 6;
        });
        if (idx66 >= 0) {
            Oponentes[0].push(Pool.splice(idx66, 1)[0]);
        }

        Pool.sort(function(A, B) {
            return this.CalcularFuerzaFichaUltraLocal(B) - this.CalcularFuerzaFichaUltraLocal(A);
        }.bind(this));

        var CorteFortes = Math.min(Pool.length, 18);
        var PoolForte = this.BarajarListaUltraLocal(Pool.slice(0, CorteFortes));
        var PoolReste = this.BarajarListaUltraLocal(Pool.slice(CorteFortes));
        Pool = PoolForte.concat(PoolReste);

        while ((Oponentes[0].length + Oponentes[1].length) < 14 && Pool.length > 0) {
            var Objetivo = (Oponentes[0].length <= Oponentes[1].length) ? Oponentes[0] : Oponentes[1];
            Objetivo.push(Pool.shift());
        }

        Pool.sort(function(A, B) {
            return this.CalcularCargaFichaUltraLocal(B) - this.CalcularCargaFichaUltraLocal(A);
        }.bind(this));

        var CorteCarga = Math.min(Pool.length, 14);
        var PoolCharge = this.BarajarListaUltraLocal(Pool.slice(0, CorteCarga));
        var PoolFaible = this.BarajarListaUltraLocal(Pool.slice(CorteCarga));
        Pool = PoolCharge.concat(PoolFaible);

        while (CampoJugador.length < 14 && Pool.length > 0) {
            CampoJugador.push(Pool.shift());
        }

        CampoJugador = this.BarajarListaUltraLocal(CampoJugador);
        Oponentes[0] = this.BarajarListaUltraLocal(Oponentes[0]);
        Oponentes[1] = this.BarajarListaUltraLocal(Oponentes[1]);

        var ManoJugador = CampoJugador.slice(0, 7);
        var ManoAliado = CampoJugador.slice(7, 14);
        var ManoOponente1 = Oponentes[0].slice(0, 7);
        var ManoOponente2 = Oponentes[1].slice(0, 7);

        return ManoJugador.concat(ManoOponente1, ManoAliado, ManoOponente2);
    };

    this.TableroListo = function() {
        return (
            this.FichaIzquierda &&
            typeof(this.FichaIzquierda.ValorLibre) === "function" &&
            this.FichaDerecha &&
            typeof(this.FichaDerecha.ValorLibre) === "function"
        );
    };

    this.ContarFichasColocadasSeat = function(Seat) {
        if (typeof(Seat) !== "number" || Seat < 0 || Seat > 3) return 0;
        var Colocadas = 0;
        var Ini = this.SeatInicio(Seat);
        for (var i = 0; i < 7; i++) {
            if (this.Ficha[Ini + i] && this.Ficha[Ini + i].Colocada === true) {
                Colocadas++;
            }
        }
        return Colocadas;
    };

    this.PrepararSesion = function() {
        var S = (typeof(window.GameSession) !== "undefined") ? window.GameSession : null;
        this.Multijugador = (S && S.roomId) ? true : false;
        this.LocalSeat = (S && typeof(S.seatIndex) === "number") ? S.seatIndex : 0;
        this.EsHost = (S && S.isHost === true) ? true : false;
        this.SeatsHumanos = (S && S.humanSeats && S.humanSeats.length > 0) ? S.humanSeats : [0];

        var NombresSesion = (S && S.playerNames && S.playerNames.length) ? S.playerNames : ((S && S.playerEmails && S.playerEmails.length) ? S.playerEmails : []);
        if (NombresSesion.length) {
            for (var i = 0; i < 4; i++) {
                this.Opciones.NombreJugador[i] = NombresSesion[i] ? NombresSesion[i] : ("Robot " + (i + 1));
            }
        }
    };

    this.CancelarAnimacionInicio = function() {
        if (this.RAFAnimacionInicio !== 0) {
            cancelAnimationFrame(this.RAFAnimacionInicio);
            this.RAFAnimacionInicio = 0;
        }
    };

    this.HayAnimacionInicioActiva = function() {
        return (this.AnimacionInicioActiva === true);
    };

    this.ObtenerSesionAnimacionInicio = function() {
        return (typeof(window.GameSession) !== "undefined" && window.GameSession) ? window.GameSession : null;
    };

    this.ObtenerClaveAnimacionInicio = function() {
        var S = this.ObtenerSesionAnimacionInicio();
        if (!S) return "";
        if (this.Multijugador === true) {
            if (!S.roomId) return "";
            var InicioSalaMs = Number(S.startedAtMs || 0);
            if (Number.isFinite(InicioSalaMs) === false || InicioSalaMs <= 0) return "";
            return String(S.roomId) + ":" + String(Math.trunc(InicioSalaMs));
        }
        var IntroLocalMs = Number(S.localClassicIntroAtMs || 0);
        if (Number.isFinite(IntroLocalMs) === false || IntroLocalMs <= 0) return "";
        var IntroNonce = String(S.localClassicIntroNonce || Math.trunc(IntroLocalMs)).trim();
        return "classic-local:" + IntroNonce;
    };

    this.ObtenerMsInicioAnimacion = function() {
        var S = this.ObtenerSesionAnimacionInicio();
        if (!S) return 0;
        if (this.Multijugador === true) {
            return Number(S.startedAtMs || 0);
        }
        return Number(S.localClassicIntroAtMs || 0);
    };

    this.ObtenerElapsedAnimacionInicioMs = function() {
        var InicioMs = this.ObtenerMsInicioAnimacion();
        if (Number.isFinite(InicioMs) === false || InicioMs <= 0) return this.DuracionAnimacionInicio;
        return Math.max(0, Date.now() - InicioMs);
    };

    this.DebeUsarAnimacionInicio = function() {
        var S = this.ObtenerSesionAnimacionInicio();
        if (!S) return false;
        var InicioMs = this.ObtenerMsInicioAnimacion();
        if (Number.isFinite(InicioMs) === false || InicioMs <= 0) return false;
        if (this.Multijugador === true) {
            return (S.startRevealPending === true || (Date.now() - InicioMs) < this.DuracionAnimacionInicio);
        }
        return ((Date.now() - InicioMs) < this.DuracionAnimacionInicio);
    };

    this.EaseInOutCubic = function(Tiempo) {
        if (Tiempo <= 0) return 0;
        if (Tiempo >= 1) return 1;
        return (Tiempo < 0.5) ?
            4.0 * Tiempo * Tiempo * Tiempo :
            1.0 - Math.pow(-2.0 * Tiempo + 2.0, 3.0) / 2.0;
    };

    this.EaseOutSutil = function(Tiempo) {
        if (Tiempo <= 0) return 0;
        if (Tiempo >= 1) return 1;
        var C1 = 1.70158;
        var C3 = C1 + 1.0;
        return 1.0 + (C3 * Math.pow(Tiempo - 1.0, 3.0)) + (C1 * Math.pow(Tiempo - 1.0, 2.0));
    };

    this.LerpNumero = function(Desde, Hasta, Tiempo) {
        return Desde + ((Hasta - Desde) * Tiempo);
    };

    this.ObtenerPoseFinalFicha = function(IndiceFicha) {
        var Seat = this.SeatDeFicha(IndiceFicha);
        var PosSeat = IndiceFicha - this.SeatInicio(Seat);
        var SeatVisual = this.VisualSeat(Seat);
        var CaraArriba = false;

        if (this.Multijugador === true) {
            CaraArriba = (Seat === this.LocalSeat);
        } else {
            CaraArriba = (Seat === 0) || (this.Opciones.Descubierto === "true");
        }

        if (SeatVisual === 0) {
            return { x : -3.8 + (1.25 * PosSeat), y : 0.0, z : 5.5,  rotZ : Math.PI / 2, rotX : CaraArriba ? -Math.PI / 2 : Math.PI / 2 };
        }
        if (SeatVisual === 1) {
            return { x : 15.0, y : 0.0, z : -6.5 + (1.25 * PosSeat), rotZ : 0.0, rotX : CaraArriba ? -Math.PI / 2 : Math.PI / 2 };
        }
        if (SeatVisual === 2) {
            return { x : -3.8 + (1.25 * PosSeat), y : 0.0, z : -12.0, rotZ : Math.PI / 2, rotX : CaraArriba ? -Math.PI / 2 : Math.PI / 2 };
        }
        return { x : -15.0, y : 0.0, z : -6.5 + (1.25 * PosSeat), rotZ : 0.0, rotX : CaraArriba ? -Math.PI / 2 : Math.PI / 2 };
    };

    this.ObtenerPoseBrassageFicha = function(IndiceFicha, TiempoMs) {
        var Segundos = TiempoMs / 1000.0;
        var Seed = IndiceFicha + 1;
        var RadioBase = 1.0 + ((IndiceFicha % 7) * 0.22);
        var Pulso = 1.0 + (0.18 * Math.sin((Segundos * 4.6) + (Seed * 0.37)));
        var Angulo = ((Segundos * (1.7 + ((Seed % 5) * 0.19))) * Math.PI * 2.0) + (Seed * 0.58);
        var DerivaX = Math.sin((Segundos * 3.1) + Seed) * 0.65;
        var DerivaZ = Math.cos((Segundos * 2.3) + (Seed * 0.41)) * 0.55;
        return {
            x : (Math.cos(Angulo) * RadioBase * Pulso) + DerivaX,
            y : 0.06 + (0.02 * (IndiceFicha % 4)),
            z : (Math.sin(Angulo * 1.1) * RadioBase * 0.8 * Pulso) + DerivaZ,
            rotZ : ((Angulo % (Math.PI * 2.0)) + (((Seed % 4) - 1.5) * 0.18)),
            rotX : Math.PI / 2
        };
    };

    this.AplicarPoseFicha = function(IndiceFicha, Pose) {
        if (typeof(this.Ficha[IndiceFicha]) === "undefined" || !this.Ficha[IndiceFicha].Ficha || !Pose) return;
        this.Ficha[IndiceFicha].Ficha.position.set(Pose.x, (typeof(Pose.y) === "number") ? Pose.y : 0.0, Pose.z);
        this.Ficha[IndiceFicha].Ficha.rotation.z = Pose.rotZ;
        this.Ficha[IndiceFicha].Ficha.rotation.x = Pose.rotX;
        this.Ficha[IndiceFicha].Ficha.scale.set(1.0, 1.0, 1.0);
    };

    this.PosicionarFichasFinales = function() {
        for (var idx = 0; idx < this.Ficha.length; idx++) {
            this.AplicarPoseFicha(idx, this.ObtenerPoseFinalFicha(idx));
        }
    };

    this.ActualizarAnimacionInicio = function() {
        var ElapsedMs = this.ObtenerElapsedAnimacionInicioMs();
        if (ElapsedMs >= this.DuracionAnimacionInicio) {
            this.AnimacionInicioActiva = false;
            this.CancelarAnimacionInicio();
            this.PosicionarFichasFinales();
            return;
        }

        var RevealProgress = Math.max(0, Math.min(1, (ElapsedMs - (this.BrassageAnimacionInicio + this.RepartoAnimacionInicio)) / Math.max(1, this.DuracionAnimacionInicio - (this.BrassageAnimacionInicio + this.RepartoAnimacionInicio))));

        for (var idx = 0; idx < this.Ficha.length; idx++) {
            var Pose = null;
            if (ElapsedMs < this.BrassageAnimacionInicio) {
                Pose = this.ObtenerPoseBrassageFicha(idx, ElapsedMs);
            } else {
                var InicioPose = this.ObtenerPoseBrassageFicha(idx, this.BrassageAnimacionInicio);
                var FinalPose = this.ObtenerPoseFinalFicha(idx);
                var TiempoReparto = ElapsedMs - this.BrassageAnimacionInicio;
                var InicioFichaMs = idx * this.RetrasoRepartoAnimacionInicio;
                var AvanceFicha = Math.max(0, Math.min(1, (TiempoReparto - InicioFichaMs) / this.ViajeRepartoAnimacionInicio));
                var Suavizado = this.EaseInOutCubic(AvanceFicha);
                Pose = {
                    x : this.LerpNumero(InicioPose.x, FinalPose.x, Suavizado),
                    y : this.LerpNumero(InicioPose.y, FinalPose.y, Suavizado) + (Math.sin(Math.PI * Suavizado) * 0.18),
                    z : this.LerpNumero(InicioPose.z, FinalPose.z, Suavizado),
                    rotZ : this.LerpNumero(InicioPose.rotZ, FinalPose.rotZ, Suavizado),
                    rotX : FinalPose.rotX
                };

                var SeatFicha = this.SeatDeFicha(idx);
                if (this.Multijugador === true && SeatFicha === this.LocalSeat) {
                    var Volteo = Math.max(0, Math.min(1, (AvanceFicha - 0.78) / 0.22));
                    Pose.rotX = this.LerpNumero(Math.PI / 2, -Math.PI / 2, this.EaseOutSutil(Volteo));
                } else {
                    Pose.rotX = Math.PI / 2;
                }

                if (RevealProgress > 0) {
                    Pose.y += 0.02 * RevealProgress;
                }
            }
            this.AplicarPoseFicha(idx, Pose);
        }

        this.CancelarAnimacionInicio();
        this.RAFAnimacionInicio = requestAnimationFrame(function() {
            this.RAFAnimacionInicio = 0;
            if (this.AnimacionInicioActiva !== true) return;
            this.ActualizarAnimacionInicio();
        }.bind(this));
    };

    this.IniciarAnimacionInicio = function() {
        if (this.DebeUsarAnimacionInicio() !== true) {
            this.AnimacionInicioActiva = false;
            this.CancelarAnimacionInicio();
            this.PosicionarFichasFinales();
            return false;
        }

        var Clave = this.ObtenerClaveAnimacionInicio();
        if (!Clave) {
            this.AnimacionInicioActiva = false;
            this.CancelarAnimacionInicio();
            this.PosicionarFichasFinales();
            return false;
        }

        if (this.ClaveAnimacionInicio !== Clave) {
            this.ClaveAnimacionInicio = Clave;
        }

        if (this.ObtenerElapsedAnimacionInicioMs() >= this.DuracionAnimacionInicio) {
            this.AnimacionInicioActiva = false;
            this.CancelarAnimacionInicio();
            this.PosicionarFichasFinales();
            return false;
        }

        this.AnimacionInicioActiva = true;
        this.ActualizarAnimacionInicio();
        return true;
    };

    this.AplicarOrdenFichas = function() {
        var S = (typeof(window.GameSession) !== "undefined") ? window.GameSession : null;
        var DificultadLocal = this.ObtenerDificultadBotLocal();
        this.DebugLog("AplicarOrdenFichas:begin", {
            multijugador: this.Multijugador,
            hasSession: !!S,
            deckOrderLength: (S && Array.isArray(S.deckOrder)) ? S.deckOrder.length : 0,
            botDifficulty: DificultadLocal
        });
        if (this.Multijugador === false || !S || !Array.isArray(S.deckOrder) || S.deckOrder.length !== 28) {
            if (this.Multijugador === true) {
                this.DebugLog("AplicarOrdenFichas:fallbackRandom", {
                    hasSession: !!S,
                    deckOrderLength: (S && Array.isArray(S.deckOrder)) ? S.deckOrder.length : 0
                });
            }
            if (this.Multijugador === false && DificultadLocal === "ultra") {
                for (var r = 0; r < this.Ficha.length; r++) {
                    this.Ficha[r].Colocada = false;
                }
                this.Ficha = this.ConstruirOrdenFichasUltraLocal();
                this.DebugLog("AplicarOrdenFichas:ultraRiggedLocal", {
                    localSeat: this.LocalSeat
                });
                return;
            }
            for (var i = this.Ficha.length - 1; i > 0; i--) {
                this.Ficha[i].Colocada = false;
                var j = Math.floor(Math.random() * (i + 1));
                var x = this.Ficha[i];
                this.Ficha[i] = this.Ficha[j];
                this.Ficha[j] = x;
            }
            return;
        }

        for (var f = 0; f < this.Ficha.length; f++) {
            this.Ficha[f].Colocada = false;
        }

        var OrdenValido = true;
        var Vistos = { };
        for (var v = 0; v < 28; v++) {
            var idxOrden = Number(S.deckOrder[v]);
            if (Number.isFinite(idxOrden) === false || idxOrden < 0 || idxOrden >= this.Ficha.length || typeof(this.Ficha[idxOrden]) === "undefined" || Vistos[idxOrden] === true) {
                OrdenValido = false;
                break;
            }
            Vistos[idxOrden] = true;
        }

        if (OrdenValido === false) {
            if (typeof(console) !== "undefined" && typeof(console.warn) === "function") {
                console.warn("[DOMINO] deckOrder invalide, conservation de l'ordre canonique.", S.deckOrder);
            }
            return;
        }

        var Nuevo = [];
        for (var k = 0; k < 28; k++) {
            Nuevo.push(this.Ficha[Number(S.deckOrder[k])]);
        }
        this.Ficha = Nuevo;
        this.DebugLog("AplicarOrdenFichas:applied", {
            deckOrderLength: S.deckOrder.length
        });
    };

    this.PosibilidadesJugador = function(seat) {
        var Posibilidades = [];
        if (this.TableroListo() === false) return Posibilidades;
        var Ini = this.SeatInicio(seat);
        for (var i = 0; i < 7; i++) {
            var idx = Ini + i;
            if (this.Ficha[idx].Colocada === false) {
                if (this.Ficha[idx].Valores[0] === this.FichaIzquierda.ValorLibre() || this.Ficha[idx].Valores[1] === this.FichaIzquierda.ValorLibre()) {
                    Posibilidades.push({ Pos : idx, Rama : "izquierda" });
                }
                if (this.Ficha[idx].Valores[0] === this.FichaDerecha.ValorLibre() || this.Ficha[idx].Valores[1] === this.FichaDerecha.ValorLibre()) {
                    Posibilidades.push({ Pos : idx, Rama : "derecha" });
                }
            }
        }
        Posibilidades.sort(function(a, b) {
            var va = this.Ficha[a.Pos].Valores[0] + this.Ficha[a.Pos].Valores[1];
            var vb = this.Ficha[b.Pos].Valores[0] + this.Ficha[b.Pos].Valores[1];
            return vb - va;
        }.bind(this));
        return Posibilidades;
    };

    this.PuedeJugarEnRama = function(idx, rama) {
        if (typeof(this.Ficha[idx]) === "undefined" || this.Ficha[idx].Colocada === true) return false;
        if (rama !== "izquierda" && rama !== "derecha") return false;
        var Libre = (rama === "izquierda") ? this.FichaIzquierda.ValorLibre() : this.FichaDerecha.ValorLibre();
        return (this.Ficha[idx].Valores[0] === Libre || this.Ficha[idx].Valores[1] === Libre);
    };

    this.RamasDisponiblesFicha = function(idx) {
        var Ret = [];
        if (this.PuedeJugarEnRama(idx, "izquierda")) Ret.push("izquierda");
        if (this.PuedeJugarEnRama(idx, "derecha"))   Ret.push("derecha");
        return Ret;
    };

    this.SeatDeFicha = function(tilePos) {
        return Math.floor(tilePos / 7);
    };

    this.DebeAnimarAccionEnRehidratacion = function(Accion) {
        var S = (typeof(window.GameSession) !== "undefined") ? window.GameSession : null;
        return (
            this.Multijugador === true &&
            this.ModoRehidratacion === true &&
            !!S &&
            S.startRevealPending === true &&
            Accion &&
            Accion.type === "play" &&
            typeof(Accion.seq) === "number" &&
            Accion.seq === 0
        );
    };

    this.ValidarAccionPlay = function(Accion) {
        var idx = Accion.tilePos;
        if (typeof(idx) !== "number" || idx < 0 || idx >= this.Ficha.length) return false;
        if (this.Ficha[idx].Colocada === true) return false;
        if (this.SeatDeFicha(idx) !== Accion.player) return false;

        // Le réseau transporte explicitement les deux côtés pour éviter toute ambiguïté.
        if (typeof(Accion.tileLeft) !== "number" || typeof(Accion.tileRight) !== "number") return false;
        if (this.Ficha[idx].Valores[0] !== Accion.tileLeft || this.Ficha[idx].Valores[1] !== Accion.tileRight) return false;

        if (this.TurnoActual === 0) {
            return (this.Ficha[idx].Valores[0] === 6 && this.Ficha[idx].Valores[1] === 6);
        }

        if (this.TableroListo() === false) return false;

        if (Accion.branch !== "izquierda" && Accion.branch !== "derecha") return false;
        var libre = (Accion.branch === "izquierda") ? this.FichaIzquierda.ValorLibre() : this.FichaDerecha.ValorLibre();
        return (this.Ficha[idx].Valores[0] === libre || this.Ficha[idx].Valores[1] === libre);
    };

    this.ResolverIndiceAccionPlay = function(Accion) {
        if (this.ValidarAccionPlay(Accion) === true) return Accion.tilePos;

        // Fallback robuste : retrouve la tuile par ses 2 côtés dans la main du joueur.
        var ini = this.SeatInicio(Accion.player);
        for (var i = 0; i < 7; i++) {
            var idx = ini + i;
            if (this.Ficha[idx].Colocada === true) continue;
            if (this.Ficha[idx].Valores[0] !== Accion.tileLeft || this.Ficha[idx].Valores[1] !== Accion.tileRight) continue;

            var Candidato = {
                player: Accion.player,
                tilePos: idx,
                tileLeft: Accion.tileLeft,
                tileRight: Accion.tileRight,
                branch: Accion.branch
            };
            if (this.ValidarAccionPlay(Candidato) === true) return idx;
        }
        return -1;
    };

    this.ValidarAccionPass = function(Accion) {
        var Pos = this.PosibilidadesJugador(Accion.player);
        return (Pos.length === 0);
    };

    this.CrearAccionPlay = function(player, idx, branch) {
        return {
            type: "play",
            player: player,
            tilePos: idx,
            tileLeft: this.Ficha[idx].Valores[0],
            tileRight: this.Ficha[idx].Valores[1],
            branch: branch
        };
    };

    this.ProcesarPendientes = function() {
        if (this.HayAnimacionColocarActiva() === true) return false;
        if (typeof(this.AccionesPendientes[this.SiguienteAccionSeq]) === "undefined") return false;
        var Pendiente = this.AccionesPendientes[this.SiguienteAccionSeq];
        delete this.AccionesPendientes[this.SiguienteAccionSeq];
        this.DebugLog("ProcesarPendientes", {
            seq: Pendiente.seq,
            type: Pendiente.type,
            player: Pendiente.player
        });
        this.AplicarAccionMultijugador(Pendiente);
        return true;
    };

    this.HayAnimacionColocarActiva = function() {
        for (var f = 0; f < this.Ficha.length; f++) {
            if (typeof(this.Ficha[f].AniColocar) !== "undefined" && this.Ficha[f].AniColocar.Terminado() === false) {
                return true;
            }
        }
        return false;
    };

    this.PublicarAccion = async function(accion) {
        if (!window.LogiqueJeu || typeof(window.LogiqueJeu.pushAction) !== "function") return;
        if (this.EsperandoPublicar === true) return;
        if (this.Multijugador === true && accion && typeof(accion) === "object") {
            if (accion.type === "play" && this.ValidarAccionPlay(accion) !== true) return;
            if (accion.type === "pass" && this.ValidarAccionPass(accion) !== true) return;
        }

        this.EsperandoPublicar = true;
        this.DebugLog("PublicarAccion", {
            actionType: accion && accion.type,
            actionPlayer: accion && accion.player,
            actionBranch: accion && accion.branch
        });
        try {
            await window.LogiqueJeu.pushAction(accion);
        }
        catch (e) {
            console.error("Error publicando accion", e);
            this.EsperandoPublicar = false;
        }
    };

    this.JugarAutomaticoSeat = function(Seat, Aleatorio) {
        if (this.Multijugador === false || this.ManoTerminada === true) return false;
        if (this.ModoRehidratacion === true) return false;
        if (typeof(Seat) !== "number" || Seat < 0 || Seat > 3) return false;

        // Turno inicial: debe salir el 6-6 del jugador que lo tenga.
        if (this.TurnoActual === 0) {
            var Ini0 = this.SeatInicio(Seat);
            for (var j = 0; j < 7; j++) {
                var idx66 = Ini0 + j;
                if (this.Ficha[idx66].Colocada === false && this.Ficha[idx66].Valores[0] === 6 && this.Ficha[idx66].Valores[1] === 6) {
                    this.PublicarAccion(this.CrearAccionPlay(Seat, idx66, "centro"));
                    return true;
                }
            }
            return false;
        }

        if (this.TableroListo() === false) return false;

        var Pos = this.PosibilidadesJugador(Seat);
        if (Pos.length > 0) {
            var Elegida = Pos[0];
            if (Aleatorio === true) {
                Elegida = Pos[Math.floor(Math.random() * Pos.length)];
            }
            this.PublicarAccion(this.CrearAccionPlay(Seat, Elegida.Pos, Elegida.Rama));
            return true;
        }

        this.PublicarAccion({ type: "pass", player: Seat });
        return true;
    };

    this.IniciarRehidratacion = function() {
        this.CancelarReintentoTurno();
        this.CancelarEsperaFinMano();
        this.CancelarTemporizadoresTurnoLocal();
        this.ModoRehidratacion = true;
        this.EsperandoPublicar = false;
        this.AccionesPendientes = {};
        this.ReintentosAccion = {};
        this.ReintentosTurno = {};
        this.ServerWinnerShown = false;
        this.DebugLog("IniciarRehidratacion");
    };

    this.FinalizarRehidratacion = function() {
        this.CancelarReintentoTurno();
        this.CancelarEsperaFinMano();
        this.CancelarTemporizadoresTurnoLocal();
        this.ModoRehidratacion = false;
        this.DebugLog("FinalizarRehidratacion");
        this.Turno();
    };

    this.Empezar = function() {
        this.Mano = 0;
        this.PrepararSesion();
        this.Continuar();
    };

    this.Continuar = function() {
        if (this.ContinuandoPartida === true) return;
        this.ContinuandoPartida = true;
        this.CancelarAnimacionInicio();
        this.CancelarTemporizadoresTurnoLocal();
        this.AnimacionInicioActiva = false;
        this.ClaveAnimacionInicio = "";

        UI.OcultarEmpezar();
        UI.OcultarContinuar();
        UI.OcultarEmpate();
        UI.MostrarDatosMano();

        this.Mano ++;
        this.ManoTerminada = false;
        this.EsperandoPublicar = false;
        this.SiguienteAccionSeq = 0;
        this.AccionesPendientes = {};
        this.ReintentosAccion = {};
        this.ReintentosTurno = {};
        this.CancelarEsperaFinMano();
        this.ServerWinnerShown = false;

        document.getElementById("Historial").innerHTML = "";

        this.CrearFichas();
        this.Pasado = 0;

        this.AplicarOrdenFichas();
        if (this.IniciarAnimacionInicio() !== true) {
            this.PosicionarFichasFinales();
        }

        this.JugadorActual = this.JugadorInicio();
        this.TurnoActual = 0;
        window.ContadorDerecha      = 0;
        window.ContadorIzquierda    = 0;
        window.FinContadorIzquierda = 5;
        window.FinContadorDerecha   = 5;

        this.Turno();
    };

    this.Turno = function() {
        if (this.ModoRehidratacion === true) return;
        if (this.ManoTerminada === true) return;
        this.CancelarReintentoTurno();
        this.CancelarTemporizadoresTurnoLocal();
        if (this.HayAnimacionInicioActiva() === true) {
            this.DebugLog("Turno:waitingDealIntro", {
                elapsedMs: this.ObtenerElapsedAnimacionInicioMs()
            });
            this.MostrarMensaje(this.LocalSeat,
                "<span data-idioma-en='Shuffling and dealing dominoes...' data-idioma-cat='Barrejant i repartint fitxes...' data-idioma-es='Barajando y repartiendo fichas...'></span>", "negro");
            this.ProgramarReintentoTurno(120, "Turno:retryWaitingDealIntro", {
                elapsedMs: this.ObtenerElapsedAnimacionInicioMs()
            });
            return;
        }
        this.DebugLog("Turno:enter", {
            tableroListo: this.TableroListo(),
            esTurnoHumanoLocal: this.EsTurnoHumanoLocal(),
            esTurnoHumanoRemoto: this.EsTurnoHumanoRemoto()
        });
        if (this.Multijugador === true) {
            var S = (typeof(window.GameSession) !== "undefined") ? window.GameSession : null;
            if (S && S.startRevealPending === true) {
                this.DebugLog("Turno:waitingStartReveal", {
                    expectedSeq: this.SiguienteAccionSeq
                });
                this.MostrarMensaje(this.LocalSeat,
                    "<span data-idioma-en='Waiting for players to see the table...' data-idioma-cat='Esperant que els jugadors vegin la taula...' data-idioma-es='Esperando a que los jugadores vean la mesa...'></span>", "negro");
                this.ProgramarReintentoTurno(120, "Turno:retryWaitingStartReveal", {
                    expectedSeq: this.SiguienteAccionSeq
                });
                return;
            }
            // Si hay una acción de red pendiente para el seq esperado, se aplica primero.
            if (this.ProcesarPendientes() === true) return;
            if (this.HayAnimacionColocarActiva() === true) {
                var TienePendienteEsperada = (typeof(this.AccionesPendientes[this.SiguienteAccionSeq]) !== "undefined");
                this.DebugLog(TienePendienteEsperada ? "Turno:waitingPendingAnimation" : "Turno:waitingAnimation", {
                    expectedSeq: this.SiguienteAccionSeq
                });
                this.ProgramarReintentoTurno(TienePendienteEsperada ? 90 : 120, "Turno:retryAfterAnimation", {
                    expectedSeq: this.SiguienteAccionSeq,
                    hasExpectedPending: TienePendienteEsperada
                });
                return;
            }
        }

        document.getElementById("Mano").innerHTML = this.Mano;
        document.getElementById("Turno").innerHTML = this.TurnoActual;
        document.getElementById("Jugador").innerHTML = (this.JugadorActual + 1);

        if (this.Opciones.AniTurno === "true") Domino.AnimarLuz(this.VisualSeat(this.JugadorActual));

        if (this.Multijugador === true && this.TurnoActual > 0 && this.TableroListo() === false) {
            this.DebugLog("Turno:waitingBoard");
            this.MostrarMensaje(this.LocalSeat, "<span data-idioma-en='Syncing board...' data-idioma-cat='Sincronitzant tauler...' data-idioma-es='Sincronizando tablero...'></span>", "negro");
            this.ProgramarReintentoTurno(120, "Turno:retryWaitingBoard", {
                expectedSeq: this.SiguienteAccionSeq
            });
            return;
        }

        if (this.TurnoActual === 0) {
            var Inicio = this.SeatInicio(this.JugadorActual);
            var pos66 = -1;
            for (var i = 0; i < 7; i++) {
                var idx = Inicio + i;
                if (this.Ficha[idx].Valores[0] === 6 && this.Ficha[idx].Valores[1] === 6) {
                    pos66 = idx;
                    break;
                }
            }

            if (pos66 === -1) return;

            if (this.Multijugador === false) {
                if (this.JugadorActual === this.LocalSeat) {
                    this.MostrarMensaje(this.JugadorActual,
                        "<span>" + this.Opciones.NombreJugador[this.JugadorActual] + "</span>" +
                        "<span data-idioma-en=' your turn ' data-idioma-cat=' el teu torn ' data-idioma-es=' tu turno '></span>");
                    this.MostrarAyuda();
                    this.IniciarCuentaAtrasTurnoHumanoLocal();
                    return;
                }
                this.MostrarMensaje(this.LocalSeat,
                    "<span data-idioma-en='Waiting bot move...' data-idioma-cat='Esperant moviment del robot...' data-idioma-es='Esperando jugada del robot...'></span>");
                this.ProgramarTurnoBotLocal(this.JugadorActual, true);
                return;
            }

            this.DebugLog("Turno:waitingOpeningSync", {
                openingSeat: this.JugadorActual
            });
            this.MostrarMensaje(this.LocalSeat, "<span data-idioma-en='Syncing board...' data-idioma-cat='Sincronitzant tauler...' data-idioma-es='Sincronizando tablero...'></span>", "negro");
            this.ProgramarReintentoTurno(120, "Turno:retryOpeningSync", {
                openingSeat: this.JugadorActual
            });
            return;
        }

        var Posibilidades = this.PosibilidadesJugador(this.JugadorActual);

        if (this.Multijugador === false) {
            if (Posibilidades.length > 0) {
                this.Pasado = 0;
                if (this.JugadorActual !== this.LocalSeat) {
                    this.MostrarMensaje(this.LocalSeat,
                        "<span data-idioma-en='Waiting bot move...' data-idioma-cat='Esperant moviment del robot...' data-idioma-es='Esperando jugada del robot...'></span>");
                    this.ProgramarTurnoBotLocal(this.JugadorActual, false);
                } else {
                    this.MostrarMensaje(this.JugadorActual,
                        "<span>" + this.Opciones.NombreJugador[this.LocalSeat] + "</span>" +
                        "<span data-idioma-en=' your turn ' data-idioma-cat=' el teu torn ' data-idioma-es=' tu turno '></span>");
                    this.MostrarAyuda();
                    this.IniciarCuentaAtrasTurnoHumanoLocal();
                }
                return;
            }

            this.MostrarMensaje(this.JugadorActual,
                "<span>" + this.Opciones.NombreJugador[this.JugadorActual] + "</span>" +
                "<span data-idioma-en='Pass...' data-idioma-cat='Pasa...' data-idioma-es='Pasa...'></span>", "rojo");
            if (window.UI && typeof(window.UI.MostrarPassVisual) === "function") {
                window.UI.MostrarPassVisual();
            }
            this.Pasado++;
            this.TurnoActual++;
            this.JugadorActual++;
            if (this.JugadorActual > 3) this.JugadorActual = 0;
            if (this.ComprobarManoTerminada() === true) return;
            setTimeout(function() { this.Turno(); }.bind(this), this.TiempoTurno);
            return;
        }

        if (this.EsTurnoHumanoLocal()) {
            if (Posibilidades.length > 0) {
                this.Pasado = 0;
                this.MostrarMensaje(this.JugadorActual,
                    "<span>" + this.Opciones.NombreJugador[this.JugadorActual] + "</span>" +
                    "<span data-idioma-en=' your turn ' data-idioma-cat=' el teu torn ' data-idioma-es=' tu turno '></span>");
                this.MostrarAyuda();
            }
            else {
                this.PublicarAccion({ type: "pass", player: this.JugadorActual });
            }
            return;
        }

        if (this.EsTurnoHumanoRemoto()) {
            this.DebugLog("Turno:waitingHumanRemote");
            this.MostrarMensaje(this.LocalSeat,
                "<span data-idioma-en='Waiting other player...' data-idioma-cat='Esperant altre jugador...' data-idioma-es='Esperando otro jugador...'></span>");
            return;
        }

        this.DebugLog("Turno:waitingBot");
        this.MostrarMensaje(this.LocalSeat,
            "<span data-idioma-en='Waiting bot move...' data-idioma-cat='Esperant moviment del robot...' data-idioma-es='Esperando jugada del robot...'></span>");
    };

    this.MostrarAyuda = function() {
        if (this.Opciones.Ayuda === "false") return;

        var Ini = this.SeatInicio(this.LocalSeat);
        var Ayuda = [];
        if (this.TurnoActual === 0) {
            for (var i = 0; i < 7; i++) {
                var idxApertura = Ini + i;
                if (this.Ficha[idxApertura].Colocada === false &&
                    this.Ficha[idxApertura].Valores[0] === 6 &&
                    this.Ficha[idxApertura].Valores[1] === 6) {
                    Ayuda.push(i);
                }
            }
        }
        else {
            if (this.TableroListo() === false) return;
            for (var i = 0; i < 7; i++) {
                var idx = Ini + i;
                if (this.Ficha[idx].Colocada === false) {
                    if ((this.Ficha[idx].Valores[0] === this.FichaIzquierda.ValorLibre() || this.Ficha[idx].Valores[1] === this.FichaIzquierda.ValorLibre()) ||
                        (this.Ficha[idx].Valores[0] === this.FichaDerecha.ValorLibre()   || this.Ficha[idx].Valores[1] === this.FichaDerecha.ValorLibre())) {
                        Ayuda.push(i);
                    }
                }
            }
        }

        var Pos = [ 5.5, 5.5, 5.5, 5.5, 5.5, 5.5, 5.5 ];
        for (var j = 0; j < Ayuda.length; j++) {
            var f = Ini + Ayuda[j];
            Pos[Ayuda[j]] = (this.Ficha[f].Valores[0] === this.Ficha[f].Valores[1]) ? 4.75 : 5.0;
        }

        if (typeof(this.AniAyuda) !== "undefined") this.AniAyuda.Terminar();

        this.AniAyuda = Animaciones.CrearAnimacion([
            { Paso : {
                P0 : this.Ficha[Ini + 0].Ficha.position.z,
                P1 : this.Ficha[Ini + 1].Ficha.position.z,
                P2 : this.Ficha[Ini + 2].Ficha.position.z,
                P3 : this.Ficha[Ini + 3].Ficha.position.z,
                P4 : this.Ficha[Ini + 4].Ficha.position.z,
                P5 : this.Ficha[Ini + 5].Ficha.position.z,
                P6 : this.Ficha[Ini + 6].Ficha.position.z
            } },
            { Paso : { P0 : Pos[0], P1 : Pos[1], P2 : Pos[2], P3 : Pos[3], P4 : Pos[4], P5 : Pos[5], P6 : Pos[6] }, Tiempo : 400, FuncionTiempo : FuncionesTiempo.SinInOut }
        ], {
            FuncionActualizar : function(V) {
                for (var n = 0; n < 7; n++) {
                    var idx = Ini + n;
                    if (this.Ficha[idx].Colocada === false) {
                        this.Ficha[idx].Ficha.position.set(this.Ficha[idx].Ficha.position.x, this.Ficha[idx].Ficha.position.y, V["P" + n]);
                    }
                }
            }.bind(this)
        });
        this.AniAyuda.Iniciar();
    };

    this.OcultarAyuda = function() {
        if (this.Opciones.Ayuda === "false") return;

        var Ini = this.SeatInicio(this.LocalSeat);
        if (typeof(this.AniAyuda) !== "undefined") this.AniAyuda.Terminar();

        this.AniAyuda = Animaciones.CrearAnimacion([
            { Paso : {
                P0 : this.Ficha[Ini + 0].Ficha.position.z,
                P1 : this.Ficha[Ini + 1].Ficha.position.z,
                P2 : this.Ficha[Ini + 2].Ficha.position.z,
                P3 : this.Ficha[Ini + 3].Ficha.position.z,
                P4 : this.Ficha[Ini + 4].Ficha.position.z,
                P5 : this.Ficha[Ini + 5].Ficha.position.z,
                P6 : this.Ficha[Ini + 6].Ficha.position.z
            } },
            { Paso : { P0 : 5.5, P1 : 5.5, P2 : 5.5, P3 : 5.5, P4 : 5.5, P5 : 5.5, P6 : 5.5 }, Tiempo : 400, FuncionTiempo : FuncionesTiempo.SinInOut }
        ], {
            FuncionActualizar : function(V) {
                for (var n = 0; n < 7; n++) {
                    var idx = Ini + n;
                    if (this.Ficha[idx].Colocada === false) {
                        this.Ficha[idx].Ficha.position.set(this.Ficha[idx].Ficha.position.x, this.Ficha[idx].Ficha.position.y, V["P" + n]);
                    }
                }
            }.bind(this)
        });
        this.AniAyuda.Iniciar();
    };

    this.AplicarAccionMultijugador = function(Accion) {
        if (this.Multijugador === false || this.ManoTerminada === true) return;

        this.DebugLog("AplicarAccion:begin", {
            seq: Accion && Accion.seq,
            type: Accion && Accion.type,
            player: Accion && Accion.player,
            branch: Accion && Accion.branch
        });
        this.EsperandoPublicar = false;
        if (typeof(Accion.seq) === "number") {
            if (Accion.seq < this.SiguienteAccionSeq) return;
            if (Accion.seq > this.SiguienteAccionSeq) {
                this.DebugLog("AplicarAccion:queueFuture", {
                    seq: Accion.seq,
                    expectedSeq: this.SiguienteAccionSeq
                });
                this.AccionesPendientes[Accion.seq] = Accion;
                return;
            }
        }
        if (Accion.player !== this.JugadorActual) {
            // Puede llegar durante una animación: se re-encola hasta que el estado local avance.
            if (typeof(Accion.seq) === "number") {
                this.AccionesPendientes[Accion.seq] = Accion;
                if (this.ModoRehidratacion === true) {
                    this.DebugLog("AplicarAccion:rehydrationWaitPlayer", {
                        seq: Accion.seq,
                        expectedPlayer: this.JugadorActual,
                        actualPlayer: Accion.player,
                        expectedTurn: this.TurnoActual,
                        branch: Accion.branch || "",
                        type: Accion.type || ""
                    });
                    return;
                }
                var RT = this.ReintentosTurno[Accion.seq] || 0;
                if (RT < 30) {
                    this.ReintentosTurno[Accion.seq] = RT + 1;
                    this.DebugLog("AplicarAccion:retryTurn", {
                        seq: Accion.seq,
                        expectedPlayer: this.JugadorActual,
                        actualPlayer: Accion.player,
                        retries: this.ReintentosTurno[Accion.seq]
                    });
                    this.ProgramarReintentoTurno(90, "AplicarAccion:retryTurnScheduled", {
                        seq: Accion.seq,
                        retries: this.ReintentosTurno[Accion.seq]
                    });
                    return;
                }
                console.error("[SYNC] Accion fuera de turno", Accion, "turno esperado:", this.JugadorActual);
                delete this.ReintentosTurno[Accion.seq];
            }
            return;
        }
        if (typeof(Accion.seq) === "number") delete this.ReintentosTurno[Accion.seq];

        if (Accion.type === "play") {
            var idxResuelto = this.ResolverIndiceAccionPlay(Accion);
            if (idxResuelto < 0) {
                var SeqKey = (typeof(Accion.seq) === "number") ? Accion.seq : -1;
                var retries = this.ReintentosAccion[SeqKey] || 0;

                // Cas transitoire: on reessaie quelques fois avant de skipper.
                if (retries < 20) {
                    this.ReintentosAccion[SeqKey] = retries + 1;
                    this.DebugLog("AplicarAccion:retryPlay", {
                        seq: Accion.seq,
                        retries: this.ReintentosAccion[SeqKey]
                    });
                    if (typeof(Accion.seq) === "number") {
                        this.AccionesPendientes[Accion.seq] = Accion;
                    }
                    if (this.ModoRehidratacion === true) return;
                    this.ProgramarReintentoTurno(120, "AplicarAccion:retryPlayScheduled", {
                        seq: Accion.seq,
                        retries: this.ReintentosAccion[SeqKey]
                    });
                    return;
                }

                if (this.HayAnimacionColocarActiva() === true && typeof(Accion.seq) === "number") {
                    this.AccionesPendientes[Accion.seq] = Accion;
                    return;
                }
                if (this.ModoRehidratacion === false) {
                    console.error("[SYNC] Accion play invalida", Accion);
                }
                if (typeof(Accion.seq) === "number") {
                    this.SiguienteAccionSeq++;
                    delete this.ReintentosAccion[Accion.seq];
                    delete this.ReintentosTurno[Accion.seq];
                }
                return;
            }
            var idx = idxResuelto;
            this.DebugLog("AplicarAccion:playResolved", {
                seq: Accion.seq,
                idx: idx,
                branch: Accion.branch
            });
            if (typeof(Accion.seq) === "number") {
                delete this.ReintentosAccion[Accion.seq];
                delete this.ReintentosTurno[Accion.seq];
            }

            var origen = false;
            if (this.TurnoActual > 0) {
                origen = (Accion.branch === "izquierda") ? this.FichaIzquierda : this.FichaDerecha;
            }
            var AnimarRehidratacion = (this.DebeAnimarAccionEnRehidratacion(Accion) === true);
            if (AnimarRehidratacion === true) {
                this.DebugLog("AplicarAccion:animateDuringRehydration", {
                    seq: Accion.seq,
                    player: Accion.player,
                    branch: Accion.branch
                });
            }
            this.Ficha[idx].Colocar(
                origen,
                Accion.player === this.LocalSeat,
                (this.ModoRehidratacion === true && AnimarRehidratacion === false),
                Accion.branch
            );
            if (this.ModoRehidratacion === false) {
                this.MostrarMensaje(Accion.player,
                    "<span>" + this.Opciones.NombreJugador[Accion.player] + "</span>" +
                    "<span data-idioma-en=' throws : ' data-idioma-cat=' tira : ' data-idioma-es=' tira : '></span>" +
                    "<img src='./Domino.svg#Ficha_" + this.Ficha[idx].Valores[1] + "-" + this.Ficha[idx].Valores[0] +"' />");
            }
            this.Pasado = 0;

            if (this.ComprobarManoTerminada(Accion.player) === true) return;
            if (this.ModoRehidratacion === false) this.OcultarAyuda();
            if (typeof(Accion.seq) === "number") {
                this.SiguienteAccionSeq++;
            }
            this.DebugLog("AplicarAccion:playApplied", {
                seq: Accion.seq,
                nextSeq: this.SiguienteAccionSeq
            });
            if (this.ModoRehidratacion === false) {
                this.ProgramarReintentoTurno(this.TiempoTurno, "AplicarAccion:playNextTurn", {
                    seq: Accion.seq,
                    nextSeq: this.SiguienteAccionSeq
                });
            }
            return;
        }

        if (Accion.type === "pass") {
            if (this.ValidarAccionPass(Accion) === false) {
                if (this.HayAnimacionColocarActiva() === true && typeof(Accion.seq) === "number") {
                    this.AccionesPendientes[Accion.seq] = Accion;
                    return;
                }
                if (this.ModoRehidratacion === false) {
                    console.error("[SYNC] Accion pass invalida", Accion);
                }
                if (typeof(Accion.seq) === "number") {
                    this.SiguienteAccionSeq++;
                    delete this.ReintentosTurno[Accion.seq];
                }
                return;
            }
            if (this.ModoRehidratacion === false) {
                this.MostrarMensaje(Accion.player,
                    "<span>" + this.Opciones.NombreJugador[Accion.player] + "</span>" +
                    "<span data-idioma-en='Pass...' data-idioma-cat='Pasa...' data-idioma-es='Pasa...'></span>", "rojo");
                if (window.UI && typeof(window.UI.MostrarPassVisual) === "function") {
                    window.UI.MostrarPassVisual();
                }
            }
            this.Pasado++;
            this.TurnoActual++;
            this.JugadorActual++;
            if (this.JugadorActual > 3) this.JugadorActual = 0;

            if (this.ComprobarManoTerminada() === true) return;
            if (typeof(Accion.seq) === "number") {
                this.SiguienteAccionSeq++;
            }
            this.DebugLog("AplicarAccion:passApplied", {
                seq: Accion.seq,
                nextSeq: this.SiguienteAccionSeq
            });
            if (this.ModoRehidratacion === false) {
                this.ProgramarReintentoTurno(this.TiempoTurno, "AplicarAccion:passNextTurn", {
                    seq: Accion.seq,
                    nextSeq: this.SiguienteAccionSeq
                });
            }
            return;
        }

        console.error("[SYNC] Tipo de accion desconocido", Accion);
        if (typeof(Accion.seq) === "number") {
            this.SiguienteAccionSeq++;
            delete this.ReintentosTurno[Accion.seq];
        }
    };

    this.ComprobarManoTerminada = function(SeatReferencia) {
        if (this.ManoTerminada === true) return true;

        var SeatComprobar = (typeof(SeatReferencia) === "number") ? SeatReferencia : this.JugadorActual;
        var Colocadas = this.ContarFichasColocadasSeat(SeatComprobar);
        var GanadorDetectado = -1;
        var MotivoDetectado = "";

        if (Colocadas === 7) {
            if (this.Multijugador === false && this.HayAnimacionColocarActiva() === true) {
                this.EsperarFinAnimacionMano(function() {
                    this.ComprobarManoTerminada(SeatComprobar);
                }.bind(this), "ComprobarManoTerminada:waitLastTileAnimation", {
                    winnerSeat: SeatComprobar,
                    reason: "out"
                });
                return true;
            }
            this.MostrarMensaje(SeatComprobar,
                "<span>" + this.Opciones.NombreJugador[SeatComprobar] + "</span>" +
                "<span data-idioma-en=' wins this hand!' data-idioma-cat=' guanya aquesta mà!' data-idioma-es=' gana esta mano!'></span>", "verde");
            GanadorDetectado = SeatComprobar;
            MotivoDetectado = "out";
        }

        if (this.Pasado === 4) {
            var MejorJugador = 0;
            var MenorPuntuacion = this.ContarPuntos(0);
            for (var j = 1; j < 4; j++) {
                var Puntos = this.ContarPuntos(j);
                if (Puntos < MenorPuntuacion) {
                    MenorPuntuacion = Puntos;
                    MejorJugador = j;
                }
            }
            this.MostrarMensaje(MejorJugador,
                "<span>" + this.Opciones.NombreJugador[MejorJugador] + "</span>" +
                "<span data-idioma-en=' wins by block' data-idioma-cat=' guanya per bloqueig' data-idioma-es=' gana por bloqueo'></span>", "verde");
            GanadorDetectado = MejorJugador;
            MotivoDetectado = "block";
        }

        if (GanadorDetectado >= 0) {
            if (this.Multijugador === true) {
                this.DebugLog("ComprobarManoTerminada:awaitServer", {
                    winnerSeat: GanadorDetectado,
                    reason: MotivoDetectado,
                    pasado: this.Pasado
                });
                if (window.LogiqueJeu && typeof(window.LogiqueJeu.onGameEnded) === "function") {
                    window.LogiqueJeu.onGameEnded(GanadorDetectado);
                }
                return false;
            }

            this.ManoTerminada = true;
            this.CancelarTemporizadoresTurnoLocal();
            UI.MostrarGanador(GanadorDetectado, MotivoDetectado);
        }

        if (this.ManoTerminada === true) {
            this.ContinuandoPartida = false;
            for (var f = 0; f < this.Ficha.length; f++) {
                this.Ficha[f].RotarBocaArriba();
            }
            return true;
        }
        return false;
    };

    this.MarcarManoTerminadaServidor = function(GanadorSeat, Motivo, Meta) {
        if (this.ServerWinnerShown === true) return true;
        var MetaInfo = (Meta && typeof(Meta) === "object") ? Meta : { };
        var ExpectedLastActionSeq = (typeof(MetaInfo.expectedLastActionSeq) === "number") ? MetaInfo.expectedLastActionSeq : -1;
        var WinnerHandVisualReady = (Motivo === "out" && this.ContarFichasColocadasSeat(GanadorSeat) >= 7);
        var DebeEsperarAccion = (ExpectedLastActionSeq >= 0 && this.SiguienteAccionSeq <= ExpectedLastActionSeq && WinnerHandVisualReady === false);
        var DebeEsperarAnimacion = (this.HayAnimacionColocarActiva() === true);
        this.DebugLog("MarcarManoTerminadaServidor:check", {
            winnerSeat: GanadorSeat,
            reason: Motivo || "out",
            expectedLastActionSeq: ExpectedLastActionSeq,
            siguienteAccionSeq: this.SiguienteAccionSeq,
            winnerHandVisualReady: WinnerHandVisualReady,
            debeEsperarAccion: DebeEsperarAccion,
            debeEsperarAnimacion: DebeEsperarAnimacion
        });
        if (DebeEsperarAccion === true || DebeEsperarAnimacion === true) {
            this.EsperarFinAnimacionMano(function() {
                this.MarcarManoTerminadaServidor(GanadorSeat, Motivo, MetaInfo);
            }.bind(this), DebeEsperarAccion === true ? "MarcarManoTerminadaServidor:waitLastAction" : "MarcarManoTerminadaServidor:waitAnimation", {
                winnerSeat: GanadorSeat,
                reason: Motivo || "out",
                expectedLastActionSeq: ExpectedLastActionSeq
            }, function() {
                var VisualWinnerReady = (Motivo === "out" && this.ContarFichasColocadasSeat(GanadorSeat) >= 7);
                var ActionReady = (ExpectedLastActionSeq < 0 || this.SiguienteAccionSeq > ExpectedLastActionSeq || VisualWinnerReady === true);
                return (this.HayAnimacionColocarActiva() === false && ActionReady === true);
            }.bind(this));
            return false;
        }
        this.DebugLog("MarcarManoTerminadaServidor:showWinner", {
            winnerSeat: GanadorSeat,
            reason: Motivo || "out",
            expectedLastActionSeq: ExpectedLastActionSeq,
            siguienteAccionSeq: this.SiguienteAccionSeq
        });
        this.ServerWinnerShown = true;
        this.CancelarEsperaFinMano();
        this.CancelarTemporizadoresTurnoLocal();
        this.ManoTerminada = true;
        this.ContinuandoPartida = false;
        this.OcultarAyuda();
        for (var f = 0; f < this.Ficha.length; f++) {
            this.Ficha[f].RotarBocaArriba();
        }
        if (window.UI && typeof(window.UI.MostrarGanador) === "function") {
            window.UI.MostrarGanador(GanadorSeat, Motivo || "out", { serverConfirmed: true });
        }
        return true;
    };

    this.ContarPuntos = function(Jugador) {
        var Total = 0;
        for (var i = 0; i < 7; i++) {
            if (this.Ficha[(Jugador * 7) + i].Colocada === false) {
                Total += (this.Ficha[(Jugador * 7) + i].Valores[0] + this.Ficha[(Jugador * 7) + i].Valores[1]);
            }
        }
        return Total;
    };

    this.MostrarMensaje = function(Jugador, Texto, ColFondo) {
        if (this.ModoRehidratacion === true) return;
        var ColorFondo = (typeof(ColFondo) === "undefined") ? "negro" : ColFondo;
        var Slot = this.VisualSeat(Jugador);
        var Msg = document.getElementById("Msg" + (Slot + 1));
        Msg.setAttribute("MsgVisible", "true");
        Msg.setAttribute("ColorFondo", ColorFondo);
        if (this.TimerMsg[Jugador] !== 0) clearTimeout(this.TimerMsg[Jugador]);
        this.TimerMsg[Jugador] = setTimeout(function(SlotJ, J) {
            document.getElementById("Msg" + (SlotJ + 1)).setAttribute("MsgVisible", "false");
            this.TimerMsg[J] = 0;
        }.bind(this, Slot, Jugador), this.TiempoTurno * 2);
        Msg.innerHTML = Texto;

        var Historial = document.getElementById("Historial");
        Historial.innerHTML = Historial.innerHTML + "<div class='Historial_" + ColorFondo + "'>" + Texto + "</div>";
        Historial.scrollTo(0, Historial.scrollHeight);
    };

    this.JugadorColocar = function(FichaForzada, RamaForzada) {
        if (this.ModoRehidratacion === true) return;
        if (this.EsTurnoHumanoLocal() === false) return;

        // En multijugador, no bloquear le clic sur les animations des autres joueurs.
        if (this.Multijugador === false) {
            for (var f = 0; f < this.Ficha.length; f++) {
                if (typeof(this.Ficha[f].AniColocar) !== "undefined" && this.Ficha[f].AniColocar.Terminado() === false) {
                    return;
                }
            }
        }

        var Ini = this.SeatInicio(this.LocalSeat);
        for (var i = 0; i < 7; i++) {
            var idx = Ini + i;
            if (typeof(FichaForzada) === "number" && idx !== FichaForzada) continue;
            if (typeof(this.Ficha[idx]) === "undefined") continue;
            if (this.Ficha[idx].Hover > 0 && this.Ficha[idx].Colocada === false) {
                if (this.TurnoActual === 0) {
                    if (this.Ficha[idx].Valores[0] === 6 && this.Ficha[idx].Valores[1] === 6) {
                        this.CancelarCuentaAtrasTurnoLocal();
                        if (this.Multijugador === true) {
                            this.OcultarAyuda();
                            this.PublicarAccion(this.CrearAccionPlay(this.JugadorActual, idx, "centro"));
                            return;
                        }

                        this.Ficha[idx].Colocar(false, true);
                        if (this.ComprobarManoTerminada(this.JugadorActual) === true) return;
                        this.OcultarAyuda();
                        setTimeout(function() { this.Turno(); }.bind(this), this.TiempoTurno);
                    }
                    return;
                }

                if (this.TableroListo() === false) return;
                var nPos = -1;
                if ((typeof(RamaForzada) === "string") && (RamaForzada === "izquierda" || RamaForzada === "derecha")) {
                    if (this.PuedeJugarEnRama(idx, RamaForzada)) {
                        nPos = (RamaForzada === "izquierda") ? this.FichaIzquierda : this.FichaDerecha;
                    }
                }

                if (nPos === -1) {
                    if ((this.Ficha[idx].Valores[0] === this.FichaIzquierda.ValorLibre() || this.Ficha[idx].Valores[1] === this.FichaIzquierda.ValorLibre()) &&
                        (this.Ficha[idx].Valores[0] === this.FichaDerecha.ValorLibre()   || this.Ficha[idx].Valores[1] === this.FichaDerecha.ValorLibre()) &&
                        (this.FichaIzquierda.ValorLibre() !== this.FichaDerecha.ValorLibre())) {
                        if (this.Ficha[idx].Hover === 1) {
                            if (this.Ficha[idx].Valores[0] === this.FichaIzquierda.ValorLibre()) nPos = this.FichaIzquierda;
                            else                                                                 nPos = this.FichaDerecha;
                        }
                        else if (this.Ficha[idx].Hover === 2) {
                            if (this.Ficha[idx].Valores[1] === this.FichaIzquierda.ValorLibre()) nPos = this.FichaIzquierda;
                            else                                                                 nPos = this.FichaDerecha;
                        }
                    }
                    else {
                        if (this.Ficha[idx].Valores[0] === this.FichaIzquierda.ValorLibre() || this.Ficha[idx].Valores[1] === this.FichaIzquierda.ValorLibre()) nPos = this.FichaIzquierda;
                        if (this.Ficha[idx].Valores[0] === this.FichaDerecha.ValorLibre() || this.Ficha[idx].Valores[1] === this.FichaDerecha.ValorLibre()) nPos = this.FichaDerecha;
                    }
                }

                if (nPos !== -1) {
                    this.CancelarCuentaAtrasTurnoLocal();
                    var rama = (nPos === this.FichaIzquierda) ? "izquierda" : "derecha";

                    if (this.Multijugador === true) {
                        this.OcultarAyuda();
                        this.PublicarAccion(this.CrearAccionPlay(this.JugadorActual, idx, rama));
                        return;
                    }

                    this.Ficha[idx].Colocar(nPos, true);
                    this.MostrarMensaje(this.JugadorActual,
                        "<span>" + this.Opciones.NombreJugador[this.JugadorActual] + "</span>" +
                        "<span data-idioma-en=' throws : ' data-idioma-cat=' tira : ' data-idioma-es=' tira : '></span>" +
                        "<img src='./Domino.svg#Ficha_" + this.Ficha[idx].Valores[1] + "-" + this.Ficha[idx].Valores[0] +"' />");

                    if (this.ComprobarManoTerminada(this.JugadorActual) === true) return;
                    this.OcultarAyuda();
                    setTimeout(function() { this.Turno(); }.bind(this), this.TiempoTurno);
                    return;
                }
            }
        }
    };
};
