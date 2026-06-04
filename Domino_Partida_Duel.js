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
    this.DuelStockHoverTileId = -1;
    this.DuelPendingDrawPose = null;
    this.ModoRehidratacion  = false;
    this.TimerReintentoTurno = 0;
    this.TimerEsperaFinMano = 0;
    this.AnimacionInicioActiva = false;
    this.RAFAnimacionInicio = 0;
    this.ClaveAnimacionInicio = "";
    this.DuracionAnimacionInicio = 5000;
    this.BrassageAnimacionInicio = 1800;
    this.RepartoAnimacionInicio = 2200;
    this.RetrasoRepartoAnimacionInicio = 46;
    this.ViajeRepartoAnimacionInicio = 310;
    this.DebugVerbose = false;

    this.Opciones = new Domino_Opciones;

    this.DebugLog = function(Etiqueta, Datos) {
        var DebugActivo = (this.DebugVerbose === true);
        if (DebugActivo !== true) {
            try {
                DebugActivo = (typeof(window) !== "undefined" && window && window.__DOMINO_DUEL_VERBOSE_DEBUG === true);
            }
            catch (_) {
                DebugActivo = false;
            }
        }
        if (DebugActivo !== true) return;
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

    this.TableroListo = function() {
        if (this.TurnoActual === 0) return true;
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
        if (!S || !S.roomId) return "";
        var InicioMs = Number(S.startedAtMs || 0);
        if (Number.isFinite(InicioMs) === false || InicioMs <= 0) return "";
        return String(S.roomId) + ":" + String(Math.trunc(InicioMs));
    };

    this.ObtenerElapsedAnimacionInicioMs = function() {
        var S = this.ObtenerSesionAnimacionInicio();
        if (!S) return this.DuracionAnimacionInicio;
        var InicioMs = Number(S.startedAtMs || 0);
        if (Number.isFinite(InicioMs) === false || InicioMs <= 0) return this.DuracionAnimacionInicio;
        return Math.max(0, Date.now() - InicioMs);
    };

    this.DebeUsarAnimacionInicio = function() {
        if (this.Multijugador !== true) return false;
        var S = this.ObtenerSesionAnimacionInicio();
        if (!S || !S.roomId) return false;
        var InicioMs = Number(S.startedAtMs || 0);
        if (Number.isFinite(InicioMs) === false || InicioMs <= 0) return false;
        return (S.startRevealPending === true || (Date.now() - InicioMs) < this.DuracionAnimacionInicio);
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
        this.DebugLog("AplicarOrdenFichas:begin", {
            multijugador: this.Multijugador,
            hasSession: !!S,
            deckOrderLength: (S && Array.isArray(S.deckOrder)) ? S.deckOrder.length : 0
        });
        if (this.Multijugador === false || !S || !Array.isArray(S.deckOrder) || S.deckOrder.length !== 28) {
            if (this.Multijugador === true) {
                this.DebugLog("AplicarOrdenFichas:fallbackRandom", {
                    hasSession: !!S,
                    deckOrderLength: (S && Array.isArray(S.deckOrder)) ? S.deckOrder.length : 0
                });
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
        var Indices = this.ObtenerIndicesManoSeat(seat);
        for (var i = 0; i < Indices.length; i++) {
            var idx = Indices[i];
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

    this.EsEleccionDobleRamaFicha = function(idx) {
        if (this.TableroListo() === false) return false;
        if (this.RamasDisponiblesFicha(idx).length !== 2) return false;
        return (this.FichaIzquierda.ValorLibre() !== this.FichaDerecha.ValorLibre());
    };

    this.ObtenerDetalleAyudaEleccionRama = function(idx, Motivo) {
        if (typeof(this.Ficha[idx]) === "undefined" || this.EsEleccionDobleRamaFicha(idx) === false) return null;
        return {
            tileValues: [ this.Ficha[idx].Valores[0], this.Ficha[idx].Valores[1] ],
            leftValue: this.FichaIzquierda.ValorLibre(),
            rightValue: this.FichaDerecha.ValorLibre(),
            reason: Motivo || "double_branch"
        };
    };

    this.MostrarAyudaEleccionRama = function(idx, Motivo, Forzar) {
        var HelpFn = window.KobposhDuelShowBranchChoiceHelp;
        if (typeof(HelpFn) !== "function") return false;
        if (Forzar !== true && this.AyudaEleccionRamaMostrada === true) return false;
        var Detail = this.ObtenerDetalleAyudaEleccionRama(idx, Motivo);
        if (!Detail) return false;
        this.AyudaEleccionRamaMostrada = true;
        return (HelpFn(Detail) === true);
    };

    this.SeatDeFicha = function(tilePos) {
        var TileId = this.ObtenerTileIdDesdeIndice(tilePos);
        for (var Seat = 0; Seat < this.DuelSeatCount(); Seat++) {
            if (this.ObtenerTileIdsManoSeat(Seat).indexOf(TileId) !== -1) return Seat;
        }
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
        var Indices = this.ObtenerIndicesManoSeat(Accion.player);
        for (var i = 0; i < Indices.length; i++) {
            var idx = Indices[i];
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

        // Turno inicial: debe salir la ficha de apertura resuelta para esta main.
        if (this.TurnoActual === 0) {
            var Apertura = this.ObtenerConfigAperturaDuel();
            if (Seat !== Apertura.seat) return false;
            var IndicesIniciales = this.ObtenerIndicesManoSeat(Seat);
            for (var j = 0; j < IndicesIniciales.length; j++) {
                var idxApertura = IndicesIniciales[j];
                if (this.Ficha[idxApertura].Colocada === false && this.ObtenerTileIdDesdeIndice(idxApertura) === Apertura.tileId) {
                    this.PublicarAccion(this.CrearAccionPlay(Seat, idxApertura, "centro"));
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
                this.Ficha[pos66].Colocar(false);
                this.MostrarMensaje(this.JugadorActual,
                    "<span>" + this.Opciones.NombreJugador[this.JugadorActual] + "</span>" +
                    "<span data-idioma-en=' throws : ' data-idioma-cat=' tira : ' data-idioma-es=' tira : '></span>" +
                    "<img src='./Domino.svg#Ficha_6-6' />");
                setTimeout(function() { this.Turno(); }.bind(this), this.TiempoTurno);
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
                if (this.JugadorActual !== 0) {
                    var seatBot = this.JugadorActual;
                    var bot = Posibilidades[0];
                    this.Ficha[bot.Pos].Colocar((bot.Rama === "izquierda") ? this.FichaIzquierda : this.FichaDerecha);
                    this.MostrarMensaje(seatBot,
                        "<span>" + this.Opciones.NombreJugador[seatBot] + "</span>" +
                        "<span data-idioma-en=' throws : ' data-idioma-cat=' tira : ' data-idioma-es=' tira : '></span>" +
                        "<img src='./Domino.svg#Ficha_" + this.Ficha[bot.Pos].Valores[1] + "-" + this.Ficha[bot.Pos].Valores[0] +"' />");
                    if (this.ComprobarManoTerminada(seatBot) === true) return;
                    setTimeout(function() { this.Turno(); }.bind(this), this.TiempoTurno);
                }
                else {
                    this.MostrarMensaje(this.JugadorActual,
                        "<span>" + this.Opciones.NombreJugador[0] + "</span>" +
                        "<span data-idioma-en=' your turn ' data-idioma-cat=' el teu torn ' data-idioma-es=' tu turno '></span>");
                    this.MostrarAyuda();
                }
                return;
            }

            this.MostrarMensaje(this.JugadorActual,
                "<span>" + this.Opciones.NombreJugador[this.JugadorActual] + "</span>" +
                "<span data-idioma-en='Pass...' data-idioma-cat='Pasa...' data-idioma-es='Pasa...'></span>", "rojo");
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
        if (this.TableroListo() === false) return;

        var Indices = this.ObtenerIndicesManoLocal();
        var Ayuda = [];
        for (var i = 0; i < Indices.length; i++) {
            var idx = Indices[i];
            if (this.Ficha[idx].Colocada === false) {
                if ((this.Ficha[idx].Valores[0] === this.FichaIzquierda.ValorLibre() || this.Ficha[idx].Valores[1] === this.FichaIzquierda.ValorLibre()) ||
                    (this.Ficha[idx].Valores[0] === this.FichaDerecha.ValorLibre()   || this.Ficha[idx].Valores[1] === this.FichaDerecha.ValorLibre())) {
                    Ayuda.push(idx);
                }
            }
        }

        var PasoInicial = {};
        var PasoFinal = {};
        for (var p = 0; p < Indices.length; p++) {
            var idxPaso = Indices[p];
            PasoInicial["P" + idxPaso] = this.Ficha[idxPaso].Ficha.position.z;
            PasoFinal["P" + idxPaso] = this.Ficha[idxPaso].Ficha.position.z;
        }
        for (var j = 0; j < Ayuda.length; j++) {
            var f = Ayuda[j];
            var TileId = this.ObtenerTileIdDesdeIndice(f);
            var Mano = this.ObtenerTileIdsManoSeat(this.LocalSeat);
            var HandIndex = Mano.indexOf(TileId);
            var PoseBase = this.ObtenerPoseManoDuel(this.LocalSeat, HandIndex, Mano.length || 1);
            PasoFinal["P" + f] = PoseBase.z - ((this.Ficha[f].Valores[0] === this.Ficha[f].Valores[1]) ? 0.75 : 0.5);
        }

        if (typeof(this.AniAyuda) !== "undefined") this.AniAyuda.Terminar();

        this.AniAyuda = Animaciones.CrearAnimacion([
            { Paso : PasoInicial },
            { Paso : PasoFinal, Tiempo : 400, FuncionTiempo : FuncionesTiempo.SinInOut }
        ], {
            FuncionActualizar : function(V) {
                for (var n = 0; n < Indices.length; n++) {
                    var idx = Indices[n];
                    if (this.Ficha[idx].Colocada === false) {
                        this.Ficha[idx].Ficha.position.set(this.Ficha[idx].Ficha.position.x, this.Ficha[idx].Ficha.position.y, V["P" + idx]);
                    }
                }
            }.bind(this)
        });
        this.AniAyuda.Iniciar();
    };

    this.OcultarAyuda = function() {
        if (this.Opciones.Ayuda === "false") return;

        var Indices = this.ObtenerIndicesManoLocal();
        if (typeof(this.AniAyuda) !== "undefined") this.AniAyuda.Terminar();

        var PasoInicial = {};
        var PasoFinal = {};
        var Mano = this.ObtenerTileIdsManoSeat(this.LocalSeat);
        for (var i = 0; i < Indices.length; i++) {
            var idx = Indices[i];
            var TileId = this.ObtenerTileIdDesdeIndice(idx);
            var HandIndex = Mano.indexOf(TileId);
            var PoseBase = this.ObtenerPoseManoDuel(this.LocalSeat, HandIndex, Mano.length || 1);
            PasoInicial["P" + idx] = this.Ficha[idx].Ficha.position.z;
            PasoFinal["P" + idx] = PoseBase.z;
        }

        this.AniAyuda = Animaciones.CrearAnimacion([
            { Paso : PasoInicial },
            { Paso : PasoFinal, Tiempo : 400, FuncionTiempo : FuncionesTiempo.SinInOut }
        ], {
            FuncionActualizar : function(V) {
                for (var n = 0; n < Indices.length; n++) {
                    var idx = Indices[n];
                    if (this.Ficha[idx].Colocada === false) {
                        this.Ficha[idx].Ficha.position.set(this.Ficha[idx].Ficha.position.x, this.Ficha[idx].Ficha.position.y, V["P" + idx]);
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

        var IndicesMano = this.ObtenerIndicesManoLocal();
        for (var i = 0; i < IndicesMano.length; i++) {
            var idx = IndicesMano[i];
            if (typeof(FichaForzada) === "number" && idx !== FichaForzada) continue;
            if (typeof(this.Ficha[idx]) === "undefined") continue;
            if (this.Ficha[idx].Hover > 0 && this.Ficha[idx].Colocada === false) {
                if (this.TurnoActual === 0) {
                    if (this.Ficha[idx].Valores[0] === 6 && this.Ficha[idx].Valores[1] === 6) {
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
                var RequiereEleccionDobleRama = this.EsEleccionDobleRamaFicha(idx);
                if (RequiereEleccionDobleRama === true && this.AyudaEleccionRamaMostrada !== true) {
                    if (this.MostrarAyudaEleccionRama(idx, "first_explanation", true) === true) return;
                }
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

                if (nPos === -1 && RequiereEleccionDobleRama === true) {
                    this.MostrarAyudaEleccionRama(idx, "center_tap", true);
                    return;
                }

                if (nPos !== -1) {
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

    this.DuelSeatCount = function() {
        return 2;
    };

    this.ObtenerSeatSiguiente = function(Seat) {
        return (Number(Seat) === 0) ? 1 : 0;
    };

    this.AvanzarTurnoDespuesColocar = function() {
        this.JugadorActual = this.ObtenerSeatSiguiente(this.JugadorActual);
        this.TurnoActual ++;
    };

    this.ObtenerSesionDuel = function() {
        return (typeof(window.GameSession) !== "undefined" && window.GameSession) ? window.GameSession : null;
    };

    this.AsegurarEstadoDuel = function() {
        var S = this.ObtenerSesionDuel();
        var Deck = (S && Array.isArray(S.deckOrder) && S.deckOrder.length === 28) ? S.deckOrder.slice(0) : [];
        var SessionKey = (S && S.roomId) ? (String(S.roomId) + ":" + String(S.startedAtMs || 0)) : "duel-local";
        if (this.DuelSessionKey === SessionKey &&
            Array.isArray(this.DuelDeckOrder) && this.DuelDeckOrder.length === 28 &&
            Array.isArray(this.DuelSeatTileIds) && this.DuelSeatTileIds.length === 2 &&
            Array.isArray(this.DuelStockTileIds)) {
            return;
        }

        this.DuelSessionKey = SessionKey;
        this.DuelDeckOrder = Deck.length === 28 ? Deck.slice(0) : [];
        this.DuelSeatTileIds = [
            this.DuelDeckOrder.slice(0, 7),
            this.DuelDeckOrder.slice(7, 14)
        ];
        this.DuelStockTileIds = this.DuelDeckOrder.slice(14);
        this.Pasado = 0;
    };

    this.ObtenerTileIdDesdeIndice = function(IndiceFicha) {
        this.AsegurarEstadoDuel();
        if (!Array.isArray(this.DuelDeckOrder) || this.DuelDeckOrder.length !== 28) return -1;
        return (typeof(this.DuelDeckOrder[IndiceFicha]) === "number") ? this.DuelDeckOrder[IndiceFicha] : -1;
    };

    this.ObtenerIndiceFichaPorTileId = function(TileId) {
        this.AsegurarEstadoDuel();
        if (!Array.isArray(this.DuelDeckOrder) || this.DuelDeckOrder.length !== 28) return -1;
        for (var i = 0; i < this.DuelDeckOrder.length; i++) {
            if (this.DuelDeckOrder[i] === TileId) return i;
        }
        return -1;
    };

    this.ObtenerTileIdsManoSeat = function(Seat) {
        this.AsegurarEstadoDuel();
        return (Array.isArray(this.DuelSeatTileIds) && Array.isArray(this.DuelSeatTileIds[Seat])) ? this.DuelSeatTileIds[Seat].slice(0) : [];
    };

    this.ObtenerIndicesManoSeat = function(Seat) {
        var TileIds = this.ObtenerTileIdsManoSeat(Seat);
        var Indices = [];
        for (var i = 0; i < TileIds.length; i++) {
            var idx = this.ObtenerIndiceFichaPorTileId(TileIds[i]);
            if (idx >= 0 && typeof(this.Ficha[idx]) !== "undefined" && this.Ficha[idx].Colocada === false) {
                Indices.push(idx);
            }
        }
        return Indices;
    };

    this.ObtenerIndicesManoLocal = function() {
        return this.ObtenerIndicesManoSeat(this.LocalSeat);
    };

    this.ObtenerIndiceStockPorTileId = function(TileId) {
        this.AsegurarEstadoDuel();
        for (var i = 0; i < this.DuelStockTileIds.length; i++) {
            if (this.DuelStockTileIds[i] === TileId) return i;
        }
        return -1;
    };

    this.VisualSeat = function(Seat) {
        if (Number(Seat) === this.LocalSeat) return 0;
        return 2;
    };

    this.SeatInicio = function(Seat) {
        return (Number(Seat) === 0) ? 0 : 7;
    };

    this.ObtenerConfigAperturaDuel = function() {
        this.AsegurarEstadoDuel();
        var S = this.ObtenerSesionDuel();
        var OpeningSeat = (S && typeof(S.openingSeat) === "number") ? Math.trunc(S.openingSeat) : -1;
        var OpeningTileId = (S && typeof(S.openingTileId) === "number") ? Math.trunc(S.openingTileId) : -1;
        var OpeningReason = (S && typeof(S.openingReason) === "string") ? String(S.openingReason) : "";

        if (OpeningSeat >= 0 && OpeningTileId >= 0) {
            return {
                seat: OpeningSeat,
                tileId: OpeningTileId,
                reason: OpeningReason
            };
        }

        for (var valor = 6; valor >= 0; valor--) {
            for (var Seat = 0; Seat < this.DuelSeatCount(); Seat++) {
                var ManoDoble = this.ObtenerTileIdsManoSeat(Seat);
                for (var i = 0; i < ManoDoble.length; i++) {
                    var TileIdDoble = ManoDoble[i];
                    var IdxDoble = this.ObtenerIndiceFichaPorTileId(TileIdDoble);
                    if (IdxDoble < 0 || typeof(this.Ficha[IdxDoble]) === "undefined") continue;
                    var ValoresDoble = this.Ficha[IdxDoble].Valores;
                    if (ValoresDoble[0] === valor && ValoresDoble[1] === valor) {
                        return {
                            seat: Seat,
                            tileId: TileIdDoble,
                            reason: (valor === 6) ? "double_six" : "highest_double"
                        };
                    }
                }
            }
        }

        var Mejor = { seat: 0, tileId: 0, score: -1, high: -1, low: -1 };
        for (var Seat2 = 0; Seat2 < this.DuelSeatCount(); Seat2++) {
            var Mano = this.ObtenerTileIdsManoSeat(Seat2);
            for (var j = 0; j < Mano.length; j++) {
                var TileId = Mano[j];
                var idx = this.ObtenerIndiceFichaPorTileId(TileId);
                if (idx < 0 || typeof(this.Ficha[idx]) === "undefined") continue;
                var Valores = this.Ficha[idx].Valores;
                var score = Valores[0] + Valores[1];
                var high = Math.max(Valores[0], Valores[1]);
                var low = Math.min(Valores[0], Valores[1]);
                if (
                    score > Mejor.score ||
                    (score === Mejor.score && high > Mejor.high) ||
                    (score === Mejor.score && high === Mejor.high && low > Mejor.low)
                ) {
                    Mejor = { seat: Seat2, tileId: TileId, score: score, high: high, low: low };
                }
            }
        }

        return {
            seat: Mejor.seat,
            tileId: Mejor.tileId,
            reason: "highest_sum"
        };
    };

    this.JugadorInicio = function() {
        return this.ObtenerConfigAperturaDuel().seat;
    };

    this.ContarFichasColocadasSeat = function(Seat) {
        var Restantes = this.ObtenerTileIdsManoSeat(Seat).length;
        return Math.max(0, 7 - Restantes);
    };

    this.PrepararSesion = function() {
        var S = this.ObtenerSesionDuel();
        this.Multijugador = (S && S.roomId) ? true : false;
        this.LocalSeat = (S && typeof(S.seatIndex) === "number") ? S.seatIndex : 0;
        this.EsHost = (S && S.isHost === true) ? true : false;
        this.SeatsHumanos = (S && S.humanSeats && S.humanSeats.length > 0) ? S.humanSeats : [this.LocalSeat];

        this.AsegurarEstadoDuel();

        var NombresSesion = (S && S.playerNames && S.playerNames.length) ? S.playerNames : ((S && S.playerEmails && S.playerEmails.length) ? S.playerEmails : []);
        for (var i = 0; i < 4; i++) {
            if (i < 2) {
                this.Opciones.NombreJugador[i] = NombresSesion[i] ? NombresSesion[i] : ("Robot " + (i + 1));
            }
            else {
                this.Opciones.NombreJugador[i] = "";
            }
        }
    };

    this.ObtenerLayoutManoDuel = function(Seat, HandIndex, Total) {
        var SafeTotal = Math.max(1, Total);
        var SafeIndex = Math.max(0, HandIndex);
        var Paso = (SafeTotal <= 7)
            ? 1.25
            : Math.max(0.96, 11.8 / Math.max(1, SafeTotal - 1));
        var InicioX = -((SafeTotal - 1) * Paso) / 2;
        return {
            fila : 0,
            col : SafeIndex,
            totalFila : SafeTotal,
            paso : Paso,
            x : InicioX + (Paso * SafeIndex)
        };
    };

    this.ObtenerPoseManoDuel = function(Seat, HandIndex, Total) {
        var Visual = this.VisualSeat(Seat);
        var Layout = this.ObtenerLayoutManoDuel(Seat, HandIndex, Total);
        var CaraArriba = (Seat === this.LocalSeat) || this.Multijugador === false || this.Opciones.Descubierto === "true";

        if (Visual === 0) {
            return {
                x : Layout.x,
                y : 0.0,
                z : 5.5,
                rotZ : Math.PI / 2,
                rotX : CaraArriba ? -Math.PI / 2 : Math.PI / 2
            };
        }

        return {
            x : Layout.x,
            y : 0.0,
            z : -12.0,
            rotZ : Math.PI / 2,
            rotX : CaraArriba ? -Math.PI / 2 : Math.PI / 2
        };
    };

    this.DebeMostrarStockAbiertoDuel = function() {
        return false;
    };

    this.ObtenerPoseStockCompactoDuel = function(StockIndex) {
        return {
            x : 40.0,
            y : -2.0,
            z : -40.0 - (StockIndex * 0.05),
            rotZ : Math.PI / 2,
            rotX : Math.PI / 2
        };
    };

    this.ObtenerPoseStockAbiertoDuel = function(StockIndex) {
        return {
            x : 40.0,
            y : -2.0,
            z : -40.0 - (StockIndex * 0.05),
            rotZ : Math.PI / 2,
            rotX : Math.PI / 2
        };
    };

    this.ObtenerPoseStockDuel = function(StockIndex) {
        if (this.DebeMostrarStockAbiertoDuel() === true) {
            return this.ObtenerPoseStockAbiertoDuel(StockIndex);
        }
        return this.ObtenerPoseStockCompactoDuel(StockIndex);
    };

    this.ObtenerPoseFinalFicha = function(IndiceFicha) {
        this.AsegurarEstadoDuel();
        var TileId = this.ObtenerTileIdDesdeIndice(IndiceFicha);
        for (var Seat = 0; Seat < this.DuelSeatCount(); Seat++) {
            var Mano = this.ObtenerTileIdsManoSeat(Seat);
            var HandIndex = Mano.indexOf(TileId);
            if (HandIndex >= 0) {
                return this.ObtenerPoseManoDuel(Seat, HandIndex, Mano.length || 7);
            }
        }

        var StockIndex = this.ObtenerIndiceStockPorTileId(TileId);
        if (StockIndex < 0) StockIndex = Math.max(0, IndiceFicha - 14);
        return this.ObtenerPoseStockDuel(StockIndex);
    };

    this.PosicionarFichasFinales = function() {
        this.AsegurarEstadoDuel();
        for (var idx = 0; idx < this.Ficha.length; idx++) {
            this.AplicarPoseFicha(idx, this.ObtenerPoseFinalFicha(idx));
        }
    };

    this.ReposicionarNoColocadasDuel = function() {
        this.AsegurarEstadoDuel();
        for (var idx = 0; idx < this.Ficha.length; idx++) {
            if (typeof(this.Ficha[idx]) === "undefined" || this.Ficha[idx].Colocada === true) continue;
            var Pose = this.ObtenerPoseFinalFicha(idx);
            this.Ficha[idx].Ficha.scale.set(1.0, 1.0, 1.0);
            this.Ficha[idx].Escala = 1.0;
            this.Ficha[idx].Ficha.position.set(Pose.x, Pose.y, Pose.z);
            this.Ficha[idx].Ficha.rotation.z = Pose.rotZ;
            this.Ficha[idx].Ficha.rotation.x = Pose.rotX;
        }
        this.ActualizarHoverStockDuel(this.DuelStockHoverTileId);
    };

    this.ObtenerIndicesStockInteractivosDuel = function() {
        this.AsegurarEstadoDuel();
        if (this.DebeMostrarStockAbiertoDuel() !== true) return [];
        var Indices = [];
        for (var i = 0; i < this.DuelStockTileIds.length; i++) {
            var idx = this.ObtenerIndiceFichaPorTileId(this.DuelStockTileIds[i]);
            if (idx >= 0 && typeof(this.Ficha[idx]) !== "undefined" && this.Ficha[idx].Colocada === false) {
                Indices.push(idx);
            }
        }
        return Indices;
    };

    this.ActualizarHoverStockDuel = function(TileId) {
        this.DuelStockHoverTileId = (typeof(TileId) === "number") ? TileId : -1;
        var Indices = this.ObtenerIndicesStockInteractivosDuel();
        for (var i = 0; i < Indices.length; i++) {
            var idx = Indices[i];
            var Ficha = this.Ficha[idx];
            if (!Ficha || !Ficha.Ficha) continue;
            var ActualTileId = this.ObtenerTileIdDesdeIndice(idx);
            var Escala = (ActualTileId === this.DuelStockHoverTileId) ? 1.08 : 1.0;
            Ficha.Ficha.scale.set(Escala, Escala, Escala);
            Ficha.Escala = Escala;
        }
    };

    this.ObtenerPosePiocheModalDuel = function(SlotIndex) {
        var SafeSlot = Math.max(0, Math.min(13, Math.trunc(Number(SlotIndex) || 0)));
        var Col = SafeSlot % 7;
        var Fila = Math.floor(SafeSlot / 7);
        return {
            x : 6.6 + (Col * 0.74),
            y : 0.18,
            z : -2.8 + (Fila * 2.3),
            rotZ : Math.PI / 2,
            rotX : Math.PI / 2
        };
    };

    this.DefinirPosePiocheDepuisModal = function(SlotIndex) {
        this.DuelPendingDrawPose = this.ObtenerPosePiocheModalDuel(SlotIndex);
    };

    this.AplicarEstadoVisualFichaRoboDuel = function(Ficha, OcultarCara) {
        if (!Ficha) return;
        var MostrarCara = (OcultarCara !== true);
        if (Ficha.Cara1) Ficha.Cara1.visible = MostrarCara;
        if (Ficha.Cara2) Ficha.Cara2.visible = MostrarCara;
        if (Ficha.Textura1) Ficha.Textura1.visible = MostrarCara;
        if (Ficha.Textura2) Ficha.Textura2.visible = MostrarCara;
        if (Ficha.Bola) Ficha.Bola.visible = MostrarCara;
    };

    this.RestaurarFichaVisibleDuel = function(Ficha) {
        if (!Ficha) return;
        if (Ficha.Cara1) {
            Ficha.Cara1.material = Texturas.MaterialCara;
            Ficha.Cara1.visible = true;
        }
        if (Ficha.Cara2) {
            Ficha.Cara2.material = Texturas.MaterialCara;
            Ficha.Cara2.visible = true;
        }
        if (Ficha.Textura1) Ficha.Textura1.visible = true;
        if (Ficha.Textura2) Ficha.Textura2.visible = true;
        if (Ficha.Bola) Ficha.Bola.visible = true;
    };

    this.AnimarRoboDuel = function(TileId, PoseOrigen, Seat) {
        if (this.ModoRehidratacion === true) return;
        if (typeof(TileId) !== "number" || !PoseOrigen) return;
        var idx = this.ObtenerIndiceFichaPorTileId(TileId);
        if (idx < 0 || typeof(this.Ficha[idx]) === "undefined" || !this.Ficha[idx].Ficha) return;

        var PoseDestino = this.ObtenerPoseFinalFicha(idx);
        var Ficha = this.Ficha[idx];
        var Partida = this;
        var OcultarCaraDuranteRobo = (this.Multijugador === true && Number(Seat) !== this.LocalSeat);
        var MidRotX = OcultarCaraDuranteRobo ? PoseOrigen.rotX : 0.0;
        if (typeof(Ficha.AniColocar) !== "undefined" && Ficha.AniColocar && typeof(Ficha.AniColocar.Terminar) === "function") {
            Ficha.AniColocar.Terminar();
            Ficha.AniColocar = undefined;
        }

        Ficha.Ficha.scale.set(1.0, 1.0, 1.0);
        Ficha.Escala = 1.0;
        Ficha.Ficha.position.set(PoseOrigen.x, PoseOrigen.y, PoseOrigen.z);
        Ficha.Ficha.rotation.z = PoseOrigen.rotZ;
        Ficha.Ficha.rotation.x = PoseOrigen.rotX;
        this.AplicarEstadoVisualFichaRoboDuel(Ficha, OcultarCaraDuranteRobo);

        Ficha.AniColocar = Animaciones.CrearAnimacion([
            { Paso : { x : PoseOrigen.x, y : PoseOrigen.y, z : PoseOrigen.z, rz : PoseOrigen.rotZ, rx : PoseOrigen.rotX, escala : 1.0 } },
            { Paso : { x : this.LerpNumero(PoseOrigen.x, PoseDestino.x, 0.32), y : 0.62, z : this.LerpNumero(PoseOrigen.z, PoseDestino.z, 0.32), rz : PoseOrigen.rotZ, rx : PoseOrigen.rotX, escala : 1.1 }, Tiempo : 220, FuncionTiempo : FuncionesTiempo.SinInOut },
            { Paso : { x : this.LerpNumero(PoseOrigen.x, PoseDestino.x, 0.68), y : 0.38, z : this.LerpNumero(PoseOrigen.z, PoseDestino.z, 0.68), rz : PoseDestino.rotZ, rx : MidRotX, escala : 1.14 }, Tiempo : 220, FuncionTiempo : FuncionesTiempo.SinInOut },
            { Paso : { x : PoseDestino.x, y : PoseDestino.y, z : PoseDestino.z, rz : PoseDestino.rotZ, rx : PoseDestino.rotX, escala : 1.0 }, Tiempo : 180, FuncionTiempo : FuncionesTiempo.SinInOut }
        ], {
            FuncionActualizar : function(Valores) {
                Ficha.Ficha.position.set(Valores.x, Valores.y, Valores.z);
                Ficha.Ficha.rotation.z = Valores.rz;
                Ficha.Ficha.rotation.x = Valores.rx;
                Ficha.Ficha.scale.set(Valores.escala, Valores.escala, Valores.escala);
                Ficha.Escala = Valores.escala;
                Partida.AplicarEstadoVisualFichaRoboDuel(Ficha, OcultarCaraDuranteRobo);
            },
            FuncionTerminado : function() {
                Ficha.Ficha.position.set(PoseDestino.x, PoseDestino.y, PoseDestino.z);
                Ficha.Ficha.rotation.z = PoseDestino.rotZ;
                Ficha.Ficha.rotation.x = PoseDestino.rotX;
                Ficha.Ficha.scale.set(1.0, 1.0, 1.0);
                Ficha.Escala = 1.0;
                Partida.RestaurarFichaVisibleDuel(Ficha);
                Ficha.AniColocar = undefined;
            }
        });
        Ficha.AniColocar.Iniciar();
    };

    this.PosibilidadesJugador = function(Seat) {
        var Posibilidades = [];
        if (this.TableroListo() === false) return Posibilidades;
        if (
            this.FichaIzquierda == null ||
            typeof(this.FichaIzquierda.ValorLibre) !== "function" ||
            this.FichaDerecha == null ||
            typeof(this.FichaDerecha.ValorLibre) !== "function"
        ) {
            return Posibilidades;
        }
        var Mano = this.ObtenerTileIdsManoSeat(Seat);
        var ValorLibreIzquierda = this.FichaIzquierda.ValorLibre();
        var ValorLibreDerecha = this.FichaDerecha.ValorLibre();
        for (var i = 0; i < Mano.length; i++) {
            var idx = this.ObtenerIndiceFichaPorTileId(Mano[i]);
            if (idx < 0 || typeof(this.Ficha[idx]) === "undefined" || this.Ficha[idx].Colocada === true) continue;
            if (this.Ficha[idx].Valores[0] === ValorLibreIzquierda || this.Ficha[idx].Valores[1] === ValorLibreIzquierda) {
                Posibilidades.push({ Pos : idx, Rama : "izquierda" });
            }
            if (this.Ficha[idx].Valores[0] === ValorLibreDerecha || this.Ficha[idx].Valores[1] === ValorLibreDerecha) {
                Posibilidades.push({ Pos : idx, Rama : "derecha" });
            }
        }
        Posibilidades.sort(function(a, b) {
            var va = this.Ficha[a.Pos].Valores[0] + this.Ficha[a.Pos].Valores[1];
            var vb = this.Ficha[b.Pos].Valores[0] + this.Ficha[b.Pos].Valores[1];
            return vb - va;
        }.bind(this));
        return Posibilidades;
    };

    this.ValidarAccionPlay = function(Accion) {
        if (!Accion) return false;
        var TileId = Number(Accion.tileId);
        if (Number.isFinite(TileId) === false) return false;
        TileId = Math.trunc(TileId);
        var idx = this.ObtenerIndiceFichaPorTileId(TileId);
        if (idx < 0 || typeof(this.Ficha[idx]) === "undefined" || this.Ficha[idx].Colocada === true) return false;
        if (this.ObtenerTileIdsManoSeat(Accion.player).indexOf(TileId) === -1) return false;

        if (this.TurnoActual === 0) {
            return (TileId === this.ObtenerConfigAperturaDuel().tileId);
        }
        if (this.TableroListo() === false) return false;
        if (Accion.branch !== "izquierda" && Accion.branch !== "derecha") return false;
        var Libre = (Accion.branch === "izquierda") ? this.FichaIzquierda.ValorLibre() : this.FichaDerecha.ValorLibre();
        return (this.Ficha[idx].Valores[0] === Libre || this.Ficha[idx].Valores[1] === Libre);
    };

    this.ResolverIndiceAccionPlay = function(Accion) {
        if (this.ValidarAccionPlay(Accion) !== true) return -1;
        return this.ObtenerIndiceFichaPorTileId(Math.trunc(Number(Accion.tileId)));
    };

    this.ValidarAccionPass = function(Accion) {
        return (this.PosibilidadesJugador(Accion.player).length === 0 && this.DuelStockTileIds.length === 0);
    };

    this.ValidarAccionDraw = function(Accion) {
        return (this.PosibilidadesJugador(Accion.player).length === 0 && this.DuelStockTileIds.length > 0);
    };

    this.CrearAccionPlay = function(Player, idx, branch) {
        var TileId = this.ObtenerTileIdDesdeIndice(idx);
        var Mano = this.ObtenerTileIdsManoSeat(Player);
        return {
            type: "play",
            player: Player,
            tileId: TileId,
            tilePos: Mano.indexOf(TileId),
            tileLeft: this.Ficha[idx].Valores[0],
            tileRight: this.Ficha[idx].Valores[1],
            branch: branch,
            side: branch
        };
    };

    this.CrearAccionDraw = function(Player) {
        return {
            type: "draw",
            player: Player
        };
    };

    this.ExtraerTileIdDeStock = function(TileId) {
        var idx = this.ObtenerIndiceStockPorTileId(TileId);
        if (idx < 0) return false;
        this.DuelStockTileIds.splice(idx, 1);
        return true;
    };

    this.ExtraerTileIdDeMano = function(Seat, TileId) {
        var Mano = this.ObtenerTileIdsManoSeat(Seat);
        var idx = Mano.indexOf(TileId);
        if (idx < 0) return false;
        this.DuelSeatTileIds[Seat].splice(idx, 1);
        return true;
    };

    this.ContarPuntos = function(Jugador) {
        var Total = 0;
        var Mano = this.ObtenerTileIdsManoSeat(Jugador);
        for (var i = 0; i < Mano.length; i++) {
            var idx = this.ObtenerIndiceFichaPorTileId(Mano[i]);
            if (idx >= 0 && typeof(this.Ficha[idx]) !== "undefined") {
                Total += (this.Ficha[idx].Valores[0] + this.Ficha[idx].Valores[1]);
            }
        }
        return Total;
    };

    this.ComprobarManoTerminada = function(SeatReferencia) {
        if (this.ManoTerminada === true) return true;

        var SeatComprobar = (typeof(SeatReferencia) === "number") ? SeatReferencia : this.JugadorActual;
        var GanadorDetectado = -1;
        var MotivoDetectado = "";

        if (this.ObtenerTileIdsManoSeat(SeatComprobar).length === 0) {
            this.MostrarMensaje(SeatComprobar,
                "<span>" + this.Opciones.NombreJugador[SeatComprobar] + "</span>" +
                "<span data-idioma-en=' wins this hand!' data-idioma-cat=' guanya aquesta mà!' data-idioma-es=' gana esta mano!'></span>", "verde");
            GanadorDetectado = SeatComprobar;
            MotivoDetectado = "out";
        }

        if (this.Pasado >= 2) {
            var MejorJugador = (this.ContarPuntos(0) <= this.ContarPuntos(1)) ? 0 : 1;
            this.MostrarMensaje(MejorJugador,
                "<span>" + this.Opciones.NombreJugador[MejorJugador] + "</span>" +
                "<span data-idioma-en=' wins by block' data-idioma-cat=' guanya per bloqueig' data-idioma-es=' gana por bloqueo'></span>", "verde");
            GanadorDetectado = MejorJugador;
            MotivoDetectado = "block";
        }

        if (GanadorDetectado >= 0) {
            if (this.Multijugador === true) {
                if (window.LogiqueJeu && typeof(window.LogiqueJeu.onGameEnded) === "function") {
                    window.LogiqueJeu.onGameEnded(GanadorDetectado);
                }
                return false;
            }

            this.ManoTerminada = true;
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

    this.MostrarAyuda = function() {
        if (this.Opciones.Ayuda === "false") return;
        if (this.TableroListo() === false) return;

        var Indices = this.ObtenerIndicesManoLocal();
        var Pos = {};
        for (var h = 0; h < Indices.length; h++) {
            Pos[Indices[h]] = this.Ficha[Indices[h]].Ficha.position.z;
        }

        var Ayuda = [];
        for (var i = 0; i < Indices.length; i++) {
            var idx = Indices[i];
            if (this.Ficha[idx].Colocada === false) {
                if ((this.Ficha[idx].Valores[0] === this.FichaIzquierda.ValorLibre() || this.Ficha[idx].Valores[1] === this.FichaIzquierda.ValorLibre()) ||
                    (this.Ficha[idx].Valores[0] === this.FichaDerecha.ValorLibre() || this.Ficha[idx].Valores[1] === this.FichaDerecha.ValorLibre())) {
                    Ayuda.push(idx);
                }
            }
        }

        if (typeof(this.AniAyuda) !== "undefined") this.AniAyuda.Terminar();
        var Inicio = {};
        var Final = {};
        for (var j = 0; j < Indices.length; j++) {
            var TileIdx = Indices[j];
            Inicio["P" + TileIdx] = this.Ficha[TileIdx].Ficha.position.z;
            Final["P" + TileIdx] = (Ayuda.indexOf(TileIdx) !== -1)
                ? ((this.Ficha[TileIdx].Valores[0] === this.Ficha[TileIdx].Valores[1]) ? 4.75 : 5.0)
                : 5.5;
        }

        this.AniAyuda = Animaciones.CrearAnimacion([
            { Paso : Inicio },
            { Paso : Final, Tiempo : 400, FuncionTiempo : FuncionesTiempo.SinInOut }
        ], {
            FuncionActualizar : function(V) {
                for (var n = 0; n < Indices.length; n++) {
                    var idxLocal = Indices[n];
                    if (this.Ficha[idxLocal].Colocada === false && typeof(V["P" + idxLocal]) === "number") {
                        this.Ficha[idxLocal].Ficha.position.set(this.Ficha[idxLocal].Ficha.position.x, this.Ficha[idxLocal].Ficha.position.y, V["P" + idxLocal]);
                    }
                }
            }.bind(this)
        });
        this.AniAyuda.Iniciar();
    };

    this.OcultarAyuda = function() {
        if (this.Opciones.Ayuda === "false") return;
        var Indices = this.ObtenerIndicesManoLocal();
        if (typeof(this.AniAyuda) !== "undefined") this.AniAyuda.Terminar();
        var Inicio = {};
        var Final = {};
        for (var i = 0; i < Indices.length; i++) {
            var idx = Indices[i];
            Inicio["P" + idx] = this.Ficha[idx].Ficha.position.z;
            Final["P" + idx] = 5.5;
        }
        this.AniAyuda = Animaciones.CrearAnimacion([
            { Paso : Inicio },
            { Paso : Final, Tiempo : 400, FuncionTiempo : FuncionesTiempo.SinInOut }
        ], {
            FuncionActualizar : function(V) {
                for (var n = 0; n < Indices.length; n++) {
                    var idxLocal = Indices[n];
                    if (this.Ficha[idxLocal].Colocada === false && typeof(V["P" + idxLocal]) === "number") {
                        this.Ficha[idxLocal].Ficha.position.set(this.Ficha[idxLocal].Ficha.position.x, this.Ficha[idxLocal].Ficha.position.y, V["P" + idxLocal]);
                    }
                }
            }.bind(this)
        });
        this.AniAyuda.Iniciar();
    };

    this.Turno = function() {
        if (this.ModoRehidratacion === true) return;
        if (this.ManoTerminada === true) return;
        this.CancelarReintentoTurno();
        if (this.HayAnimacionInicioActiva() === true) {
            this.MostrarMensaje(this.LocalSeat,
                "<span data-idioma-en='Shuffling and dealing dominoes...' data-idioma-cat='Barrejant i repartint fitxes...' data-idioma-es='Barajando y repartiendo fichas...'></span>", "negro");
            this.ProgramarReintentoTurno(120, "TurnoDuel:retryWaitingDealIntro", {
                elapsedMs: this.ObtenerElapsedAnimacionInicioMs()
            });
            return;
        }

        if (this.Multijugador === true) {
            var S = this.ObtenerSesionDuel();
            if (S && S.startRevealPending === true) {
                this.MostrarMensaje(this.LocalSeat,
                    "<span data-idioma-en='Waiting for players to see the table...' data-idioma-cat='Esperant que els jugadors vegin la taula...' data-idioma-es='Esperando a que los jugadores vean la mesa...'></span>", "negro");
                this.ProgramarReintentoTurno(120, "TurnoDuel:retryWaitingStartReveal", {
                    expectedSeq: this.SiguienteAccionSeq
                });
                return;
            }
            if (this.ProcesarPendientes() === true) return;
            if (this.HayAnimacionColocarActiva() === true) {
                this.ProgramarReintentoTurno(120, "TurnoDuel:retryAfterAnimation", {
                    expectedSeq: this.SiguienteAccionSeq
                });
                return;
            }
        }

        document.getElementById("Mano").innerHTML = this.Mano;
        document.getElementById("Turno").innerHTML = this.TurnoActual;
        document.getElementById("Jugador").innerHTML = (this.JugadorActual + 1);
        this.ReposicionarNoColocadasDuel();

        if (this.Opciones.AniTurno === "true") Domino.AnimarLuz(this.VisualSeat(this.JugadorActual));

        if (this.Multijugador === true && this.TurnoActual > 0 && this.TableroListo() === false) {
            this.MostrarMensaje(this.LocalSeat, "<span data-idioma-en='Syncing board...' data-idioma-cat='Sincronitzant tauler...' data-idioma-es='Sincronizando tablero...'></span>", "negro");
            this.ProgramarReintentoTurno(120, "TurnoDuel:retryWaitingBoard", {
                expectedSeq: this.SiguienteAccionSeq
            });
            return;
        }

        if (this.TurnoActual === 0) {
            this.MostrarMensaje(this.LocalSeat, "<span data-idioma-en='Syncing board...' data-idioma-cat='Sincronitzant tauler...' data-idioma-es='Sincronizando tablero...'></span>", "negro");
            this.ProgramarReintentoTurno(120, "TurnoDuel:retryOpeningSync", {
                openingSeat: this.JugadorActual
            });
            return;
        }

        var Posibilidades = this.PosibilidadesJugador(this.JugadorActual);
        if (this.EsTurnoHumanoLocal()) {
            if (Posibilidades.length > 0) {
                this.Pasado = 0;
                this.MostrarMensaje(this.JugadorActual,
                    "<span>" + this.Opciones.NombreJugador[this.JugadorActual] + "</span>" +
                    "<span data-idioma-en=' your turn ' data-idioma-cat=' el teu torn ' data-idioma-es=' tu turno '></span>");
                this.MostrarAyuda();
            }
            else if (this.DuelStockTileIds.length > 0) {
                this.MostrarMensaje(this.JugadorActual,
                    "<span>Ou pa gen domino pou jwe. Klike sou Lot pou piocher.</span>");
                if (window.KobposhDuelPromptLot && typeof(window.KobposhDuelPromptLot) === "function") {
                    window.KobposhDuelPromptLot({
                        player: this.JugadorActual,
                        stockCount: this.DuelStockTileIds.length
                    });
                }
            }
            else {
                this.PublicarAccion({ type: "pass", player: this.JugadorActual });
            }
            return;
        }

        if (this.EsTurnoHumanoRemoto()) {
            this.MostrarMensaje(this.LocalSeat,
                "<span data-idioma-en='Waiting other player...' data-idioma-cat='Esperant altre jugador...' data-idioma-es='Esperando otro jugador...'></span>");
            return;
        }

        this.MostrarMensaje(this.LocalSeat,
            "<span data-idioma-en='Waiting bot move...' data-idioma-cat='Esperant moviment del robot...' data-idioma-es='Esperando jugada del robot...'></span>");
    };

    this.AplicarAccionMultijugador = function(Accion) {
        if (this.Multijugador === false || this.ManoTerminada === true) return;
        this.EsperandoPublicar = false;

        if (typeof(Accion.seq) === "number") {
            if (Accion.seq < this.SiguienteAccionSeq) return;
            if (Accion.seq > this.SiguienteAccionSeq) {
                this.AccionesPendientes[Accion.seq] = Accion;
                return;
            }
        }

        if (Accion.player !== this.JugadorActual) {
            if (typeof(Accion.seq) === "number") {
                this.AccionesPendientes[Accion.seq] = Accion;
            }
            return;
        }

        if (Accion.type === "play") {
            var idx = this.ResolverIndiceAccionPlay(Accion);
            if (idx < 0) return;

            var TileId = this.ObtenerTileIdDesdeIndice(idx);
            var PoseManoAntesPlay = this.ObtenerPoseFinalFicha(idx);
            this.ExtraerTileIdDeMano(Accion.player, TileId);
            if (typeof(this.Ficha[idx].AniColocar) !== "undefined" && this.Ficha[idx].AniColocar && typeof(this.Ficha[idx].AniColocar.Terminar) === "function") {
                this.Ficha[idx].AniColocar.Terminar();
                this.Ficha[idx].AniColocar = undefined;
            }
            if (typeof(this.Ficha[idx].AniHover) !== "undefined" && this.Ficha[idx].AniHover && typeof(this.Ficha[idx].AniHover.Terminar) === "function") {
                this.Ficha[idx].AniHover.Terminar();
                this.Ficha[idx].AniHover = undefined;
            }
            this.Ficha[idx].Ficha.scale.set(1.0, 1.0, 1.0);
            this.Ficha[idx].Escala = 1.0;
            this.RestaurarFichaVisibleDuel(this.Ficha[idx]);
            if (PoseManoAntesPlay) {
                this.Ficha[idx].Ficha.position.set(PoseManoAntesPlay.x, PoseManoAntesPlay.y, PoseManoAntesPlay.z);
                this.Ficha[idx].Ficha.rotation.z = PoseManoAntesPlay.rotZ;
                this.Ficha[idx].Ficha.rotation.x = (Accion.player === this.LocalSeat) ? PoseManoAntesPlay.rotX : -Math.PI / 2;
            }

            var origen = false;
            if (this.TurnoActual > 0) {
                origen = (Accion.branch === "izquierda") ? this.FichaIzquierda : this.FichaDerecha;
            }
            this.Ficha[idx].Colocar(
                origen,
                Accion.player === this.LocalSeat,
                (this.ModoRehidratacion === true),
                Accion.branch
            );
            this.Pasado = 0;
            this.ReposicionarNoColocadasDuel();
            if (this.ComprobarManoTerminada(Accion.player) === true) return;
            if (this.ModoRehidratacion === false) this.OcultarAyuda();
            if (typeof(Accion.seq) === "number") this.SiguienteAccionSeq++;
            if (this.ModoRehidratacion === false) {
                this.ProgramarReintentoTurno(this.TiempoTurno, "AplicarAccionDuel:playNextTurn", {
                    seq: Accion.seq,
                    nextSeq: this.SiguienteAccionSeq
                });
            }
            return;
        }

        if (Accion.type === "draw") {
            var Drawn = Array.isArray(Accion.drawnTileIds) ? Accion.drawnTileIds.slice(0) : [];
            var AnimacionesRobo = [];
            for (var d = 0; d < Drawn.length; d++) {
                var DrawnId = Number(Drawn[d]);
                if (Number.isFinite(DrawnId) === false) continue;
                DrawnId = Math.trunc(DrawnId);
                var PoseOrigenRobo = null;
                if (Accion.player === this.LocalSeat && this.DuelPendingDrawPose) {
                    PoseOrigenRobo = {
                        x : this.DuelPendingDrawPose.x,
                        y : this.DuelPendingDrawPose.y,
                        z : this.DuelPendingDrawPose.z,
                        rotZ : this.DuelPendingDrawPose.rotZ,
                        rotX : this.DuelPendingDrawPose.rotX
                    };
                }
                else {
                    var StockIdxRobo = this.ObtenerIndiceStockPorTileId(DrawnId);
                    if (StockIdxRobo >= 0) {
                        PoseOrigenRobo = this.ObtenerPoseStockDuel(StockIdxRobo);
                    }
                }
                if (this.ExtraerTileIdDeStock(DrawnId) === true) {
                    this.DuelSeatTileIds[Accion.player].push(DrawnId);
                    AnimacionesRobo.push({
                        tileId: DrawnId,
                        from: PoseOrigenRobo
                    });
                }
            }
            this.Pasado = 0;
            this.DuelPendingDrawPose = null;
            this.ReposicionarNoColocadasDuel();
            if (this.ModoRehidratacion === false) {
                for (var r = 0; r < AnimacionesRobo.length; r++) {
                    this.AnimarRoboDuel(AnimacionesRobo[r].tileId, AnimacionesRobo[r].from, Accion.player);
                }
            }

            if (typeof(Accion.seq) === "number") this.SiguienteAccionSeq++;
            if (this.ModoRehidratacion === false) {
                this.ProgramarReintentoTurno(this.TiempoTurno, "AplicarAccionDuel:drawNextTurn", {
                    seq: Accion.seq,
                    nextSeq: this.SiguienteAccionSeq
                });
            }
            return;
        }

        if (Accion.type === "pass") {
            if (this.ValidarAccionPass(Accion) === false) return;
            if (this.ModoRehidratacion === false) {
                this.MostrarMensaje(Accion.player,
                    "<span>" + this.Opciones.NombreJugador[Accion.player] + "</span>" +
                    "<span data-idioma-en='Pass...' data-idioma-cat='Pasa...' data-idioma-es='Pasa...'></span>", "rojo");
                if (window.UI && typeof(window.UI.MostrarPassVisual) === "function") {
                    window.UI.MostrarPassVisual();
                }
            }
            this.Pasado++;
            this.JugadorActual = this.ObtenerSeatSiguiente(this.JugadorActual);
            this.TurnoActual ++;
            if (this.ComprobarManoTerminada() === true) return;
            if (typeof(Accion.seq) === "number") this.SiguienteAccionSeq++;
            if (this.ModoRehidratacion === false) {
                this.ProgramarReintentoTurno(this.TiempoTurno, "AplicarAccionDuel:passNextTurn", {
                    seq: Accion.seq,
                    nextSeq: this.SiguienteAccionSeq
                });
            }
            return;
        }
    };

    this.JugadorColocar = function(FichaForzada, RamaForzada) {
        if (this.ModoRehidratacion === true) return;
        if (this.EsTurnoHumanoLocal() === false) return;

        var Indices = this.ObtenerIndicesManoLocal();
        for (var i = 0; i < Indices.length; i++) {
            var idx = Indices[i];
            if (typeof(FichaForzada) === "number" && idx !== FichaForzada) continue;
            if (typeof(this.Ficha[idx]) === "undefined") continue;
            if (this.Ficha[idx].Hover > 0 && this.Ficha[idx].Colocada === false) {
                if (this.TurnoActual === 0) {
                    if (this.ObtenerTileIdDesdeIndice(idx) === this.ObtenerConfigAperturaDuel().tileId) {
                        this.OcultarAyuda();
                        this.PublicarAccion(this.CrearAccionPlay(this.JugadorActual, idx, "centro"));
                    }
                    return;
                }

                if (this.TableroListo() === false) return;
                var RequiereEleccionDobleRama = this.EsEleccionDobleRamaFicha(idx);
                if (RequiereEleccionDobleRama === true && this.AyudaEleccionRamaMostrada !== true) {
                    if (this.MostrarAyudaEleccionRama(idx, "first_explanation", true) === true) return;
                }
                var nPos = -1;
                if ((typeof(RamaForzada) === "string") && (RamaForzada === "izquierda" || RamaForzada === "derecha")) {
                    if (this.PuedeJugarEnRama(idx, RamaForzada)) {
                        nPos = (RamaForzada === "izquierda") ? this.FichaIzquierda : this.FichaDerecha;
                    }
                }

                if (nPos === -1) {
                    if ((this.Ficha[idx].Valores[0] === this.FichaIzquierda.ValorLibre() || this.Ficha[idx].Valores[1] === this.FichaIzquierda.ValorLibre()) &&
                        (this.Ficha[idx].Valores[0] === this.FichaDerecha.ValorLibre() || this.Ficha[idx].Valores[1] === this.FichaDerecha.ValorLibre()) &&
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

                if (nPos === -1 && RequiereEleccionDobleRama === true) {
                    this.MostrarAyudaEleccionRama(idx, "center_tap", true);
                    return;
                }

                if (nPos !== -1) {
                    var rama = (nPos === this.FichaIzquierda) ? "izquierda" : "derecha";
                    this.OcultarAyuda();
                    this.PublicarAccion(this.CrearAccionPlay(this.JugadorActual, idx, rama));
                    return;
                }
            }
        }

        return;
    };
};
