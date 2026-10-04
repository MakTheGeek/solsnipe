import React, { useState, useEffect } from 'react';
import { authFetch, setAuthToken } from '../api';
import {
  ShieldCheck,
  Lock,
  Unlock,
  Key,
  Eye,
  EyeOff,
  AlertTriangle,
  Radio,
  ArrowRight,
  Settings,
  Sparkles,
} from 'lucide-react';
import { SecurityStatus } from '../types';

interface DashboardLockScreenProps {
  securityStatus: SecurityStatus;
  onUnlockSuccess: (token: string, remember: boolean) => void;
  onOpenSetupModal: () => void;
  onBypassIfNoCode?: () => void;
}

export const DashboardLockScreen: React.FC<DashboardLockScreenProps> = ({
  securityStatus,
  onUnlockSuccess,
  onOpenSetupModal,
  onBypassIfNoCode,
}) => {
  const [code, setCode] = useState('');
  const [showCode, setShowCode] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [isVerifying, setIsVerifying] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [shake, setShake] = useState(false);

  // Focus input automatically
  const inputRef = React.useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleVerify = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!code.trim()) {
      setErrorMessage('Veuillez renseigner votre code de connexion');
      return;
    }

    setIsVerifying(true);
    setErrorMessage(null);

    try {
      const res = await authFetch('/api/security/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      });
      const data = await res.json();

      if (data.success && data.token) {
        setAuthToken(data.token, rememberMe);
        onUnlockSuccess(data.token, rememberMe);
      } else {
        setErrorMessage(data.message || 'Code de connexion incorrect');
        setShake(true);
        setTimeout(() => setShake(false), 500);
        setCode('');
        inputRef.current?.focus();
      }
    } catch (err: any) {
      setErrorMessage(`Erreur réseau : ${err.message || 'Impossible de vérifier le code'}`);
    } finally {
      setIsVerifying(false);
    }
  };

  const handleKeypadPress = (val: string) => {
    if (val === 'clear') {
      setCode('');
    } else if (val === 'back') {
      setCode((prev) => prev.slice(0, -1));
    } else {
      if (code.length < 16) {
        setCode((prev) => prev + val);
      }
    }
    inputRef.current?.focus();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/95 backdrop-blur-xl flex items-center justify-center p-4">
      {/* Background glow effects */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 left-1/3 w-80 h-80 bg-sky-500/10 rounded-full blur-3xl pointer-events-none" />

      <div
        className={`w-full max-w-md bg-zinc-950 border border-zinc-800 rounded-2xl p-6 sm:p-8 shadow-2xl relative z-10 transition-transform ${
          shake ? 'animate-bounce' : ''
        }`}
      >
        {/* Header Branding */}
        <div className="text-center space-y-3 mb-6">
          <div className="inline-flex p-3 rounded-2xl bg-zinc-900 border border-zinc-800 shadow-inner">
            <Lock className="w-8 h-8 text-emerald-400 animate-pulse" />
          </div>

          <div>
            <div className="flex items-center justify-center gap-2 mb-1">
              <span className="text-lg font-bold font-mono text-white uppercase tracking-wider">
                SolSnipe Terminal
              </span>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-950 text-emerald-400 border border-emerald-800/50">
                PROTÉGÉ
              </span>
            </div>
            <h2 className="text-xl font-bold text-white tracking-tight">
              Streaming Dashboard Verrouillé
            </h2>
            <p className="text-xs text-zinc-400 mt-1">
              Saisissez votre code de connexion pour accéder au live stream et aux positions de trading.
            </p>
          </div>
        </div>

        {/* If no code is configured yet */}
        {!securityStatus.hasCodeSet ? (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-sky-950/40 border border-sky-800/40 text-left space-y-2">
              <div className="flex items-center gap-2 text-sky-300 font-semibold text-xs font-mono">
                <Sparkles className="w-4 h-4 text-sky-400 shrink-0" />
                Aucun code configuré
              </div>
              <p className="text-xs text-zinc-300 leading-relaxed">
                Vous n'avez pas encore défini de code de connexion pour protéger votre dashboard streaming.
              </p>
            </div>

            <div className="flex flex-col gap-2.5">
              <button
                type="button"
                onClick={onOpenSetupModal}
                className="w-full py-3 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-bold font-mono text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer shadow-lg shadow-emerald-500/20"
              >
                <Key className="w-4 h-4" />
                Configurer mon code de connexion
              </button>

              {onBypassIfNoCode && (
                <button
                  type="button"
                  onClick={onBypassIfNoCode}
                  className="w-full py-2.5 px-4 rounded-xl bg-zinc-900 hover:bg-zinc-850 text-zinc-400 hover:text-white font-mono text-xs border border-zinc-800 transition-colors cursor-pointer"
                >
                  Accéder sans code pour le moment →
                </button>
              )}
            </div>
          </div>
        ) : (
          /* Form for existing code */
          <form onSubmit={handleVerify} className="space-y-5">
            {/* Error banner */}
            {errorMessage && (
              <div className="p-3 rounded-lg bg-red-950/60 border border-red-800/60 text-red-200 text-xs flex items-center gap-2 font-mono">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Input field */}
            <div className="space-y-2">
              <label className="text-xs font-mono text-zinc-400 block text-left">
                Code de connexion (PIN ou mot de passe)
              </label>
              <div className="relative">
                <input
                  ref={inputRef}
                  type={showCode ? 'text' : 'password'}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="••••"
                  autoComplete="current-password"
                  className="w-full px-4 py-3.5 rounded-xl bg-zinc-900 border border-zinc-800 focus:border-emerald-500 text-center text-xl font-mono tracking-widest text-white placeholder-zinc-700 outline-none transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowCode(!showCode)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors p-1"
                  title={showCode ? 'Masquer' : 'Afficher'}
                >
                  {showCode ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Tactile Keypad (0-9) */}
            <div className="grid grid-cols-3 gap-2 pt-1">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'].map((key) => {
                const isClear = key === 'clear';
                const isBack = key === 'back';
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handleKeypadPress(key)}
                    className={`py-3 rounded-xl font-mono text-sm font-semibold transition-all cursor-pointer border ${
                      isClear || isBack
                        ? 'bg-zinc-900/60 hover:bg-zinc-800 border-zinc-800/60 text-zinc-400 hover:text-white text-xs'
                        : 'bg-zinc-900 hover:bg-zinc-850 border-zinc-800 text-white active:scale-95 shadow-sm'
                    }`}
                  >
                    {isClear ? 'Effacer' : isBack ? '⌫' : key}
                  </button>
                );
              })}
            </div>

            {/* Remember Me Option */}
            <div className="flex items-center justify-between text-xs font-mono text-zinc-400 pt-1">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="rounded bg-zinc-900 border-zinc-700 text-emerald-500 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                />
                <span>Mémoriser cet appareil</span>
              </label>

              <button
                type="button"
                onClick={onOpenSetupModal}
                className="text-zinc-500 hover:text-emerald-400 transition-colors flex items-center gap-1 cursor-pointer"
              >
                <Settings className="w-3 h-3" />
                Gérer le code
              </button>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isVerifying || !code.trim()}
              className="w-full py-3.5 px-4 rounded-xl bg-white hover:bg-zinc-200 disabled:opacity-50 disabled:hover:bg-white text-black font-mono font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer shadow-lg active:scale-[0.99]"
            >
              {isVerifying ? (
                <>
                  <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                  Vérification...
                </>
              ) : (
                <>
                  <Unlock className="w-4 h-4" />
                  Déverrouiller le Dashboard
                </>
              )}
            </button>
          </form>
        )}

        {/* Footer info */}
        <div className="mt-6 pt-4 border-t border-zinc-900 text-center">
          <p className="text-[10px] font-mono text-zinc-600 flex items-center justify-center gap-1.5">
            <ShieldCheck className="w-3 h-3 text-emerald-500" />
            Sécurisation chiffrée locale SHA-256 avec sel cryptographique
          </p>
        </div>
      </div>
    </div>
  );
};
