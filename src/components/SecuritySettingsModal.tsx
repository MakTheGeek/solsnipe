import React, { useState } from 'react';
import { authFetch, setAuthToken } from '../api';
import {
  Shield,
  Key,
  Lock,
  Unlock,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertCircle,
  X,
  Clock,
  Trash2,
  Save,
} from 'lucide-react';
import { SecurityStatus } from '../types';

interface SecuritySettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  securityStatus: SecurityStatus | null;
  onStatusUpdated: (status: SecurityStatus) => void;
  onShowToast: (msg: string) => void;
}

export const SecuritySettingsModal: React.FC<SecuritySettingsModalProps> = ({
  isOpen,
  onClose,
  securityStatus: rawSecurityStatus,
  onStatusUpdated,
  onShowToast,
}) => {
  const securityStatus = rawSecurityStatus || { enabled: false, hasCodeSet: false, autoLockMinutes: 30 };
  const [activeSubTab, setActiveSubTab] = useState<'code' | 'autolock' | 'disable'>('code');

  // Form states
  const [currentCode, setCurrentCode] = useState('');
  const [newCode, setNewCode] = useState('');
  const [confirmCode, setConfirmCode] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [autoLockMinutes, setAutoLockMinutes] = useState(securityStatus.autoLockMinutes || 0);

  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSaveCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (securityStatus.hasCodeSet && !currentCode.trim()) {
      setErrorMsg('Veuillez renseigner le code actuel pour le modifier');
      return;
    }

    if (newCode.trim().length < 4) {
      setErrorMsg('Le nouveau code doit comporter au moins 4 caractères ou chiffres');
      return;
    }

    if (newCode !== confirmCode) {
      setErrorMsg('La confirmation du code ne correspond pas au nouveau code');
      return;
    }

    setIsLoading(true);

    try {
      const res = await authFetch('/api/security/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newCode: newCode.trim(),
          currentCode: currentCode.trim() || undefined,
          autoLockMinutes,
        }),
      });
      const data = await res.json();

      if (data.success) {
        if (data.token) {
          setAuthToken(data.token, true);
        }
        onStatusUpdated({
          enabled: true,
          hasCodeSet: true,
          autoLockMinutes,
        });
        onShowToast('✓ Code de connexion configuré et activé avec succès !');
        setCurrentCode('');
        setNewCode('');
        setConfirmCode('');
        onClose();
      } else {
        setErrorMsg(data.message || 'Impossible de configurer le code');
      }
    } catch (err: any) {
      setErrorMsg(`Erreur : ${err.message || 'Erreur réseau'}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleProtection = async (enable: boolean) => {
    if (!currentCode.trim()) {
      setErrorMsg('Veuillez saisir votre code actuel pour modifier ce paramètre');
      return;
    }

    setIsLoading(true);
    setErrorMsg(null);

    try {
      const res = await authFetch('/api/security/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: enable,
          currentCode: currentCode.trim(),
        }),
      });
      const data = await res.json();

      if (data.success) {
        onStatusUpdated({
          ...securityStatus,
          enabled: enable,
        });
        onShowToast(enable ? '✓ Protection par code activée' : 'Protection par code désactivée');
        setCurrentCode('');
      } else {
        setErrorMsg(data.message || 'Action refusée');
      }
    } catch (err: any) {
      setErrorMsg(`Erreur : ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveAutoLock = async () => {
    setIsLoading(true);
    setErrorMsg(null);

    try {
      const res = await authFetch('/api/security/autolock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoLockMinutes }),
      });
      const data = await res.json();

      if (data.success) {
        onStatusUpdated({
          ...securityStatus,
          autoLockMinutes,
        });
        onShowToast('✓ Délai de verrouillage automatique mis à jour');
      } else {
        setErrorMsg(data.message || 'Impossible de mettre à jour le délai');
      }
    } catch (err: any) {
      setErrorMsg(`Erreur : ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveCode = async () => {
    if (!currentCode.trim()) {
      setErrorMsg('Veuillez renseigner votre code actuel pour supprimer la protection');
      return;
    }

    setIsLoading(true);
    setErrorMsg(null);

    try {
      const res = await authFetch('/api/security/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentCode: currentCode.trim() }),
      });
      const data = await res.json();

      if (data.success) {
        onStatusUpdated({
          enabled: false,
          hasCodeSet: false,
          autoLockMinutes: 0,
        });
        onShowToast('Code de connexion supprimé avec succès');
        setCurrentCode('');
        onClose();
      } else {
        setErrorMsg(data.message || 'Code incorrect');
      }
    } catch (err: any) {
      setErrorMsg(`Erreur : ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-850 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-emerald-950/60 border border-emerald-800/40 text-emerald-400">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold font-mono text-white uppercase tracking-wider">
                Sécurité & Code d'Accès
              </h3>
              <p className="text-[11px] text-zinc-400">
                Protégez le streaming dashboard et vos clés Solana
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-900 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Subtabs */}
        <div className="flex border-b border-zinc-900 bg-zinc-900/40 px-6 pt-2 gap-2 text-xs font-mono">
          <button
            type="button"
            onClick={() => {
              setActiveSubTab('code');
              setErrorMsg(null);
            }}
            className={`pb-2.5 px-2 border-b-2 font-semibold transition-colors cursor-pointer ${
              activeSubTab === 'code'
                ? 'border-emerald-400 text-white'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {securityStatus.hasCodeSet ? 'Modifier le Code' : 'Créer un Code'}
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveSubTab('autolock');
              setErrorMsg(null);
            }}
            className={`pb-2.5 px-2 border-b-2 font-semibold transition-colors cursor-pointer ${
              activeSubTab === 'autolock'
                ? 'border-emerald-400 text-white'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Verrouillage Auto
          </button>

          {securityStatus.hasCodeSet && (
            <button
              type="button"
              onClick={() => {
                setActiveSubTab('disable');
                setErrorMsg(null);
              }}
              className={`pb-2.5 px-2 border-b-2 font-semibold transition-colors cursor-pointer ${
                activeSubTab === 'disable'
                  ? 'border-red-400 text-red-300'
                  : 'border-transparent text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Désactiver / Supprimer
            </button>
          )}
        </div>

        {/* Content body */}
        <div className="p-6 space-y-4">
          {errorMsg && (
            <div className="p-3 rounded-lg bg-red-950/60 border border-red-800/60 text-red-200 text-xs flex items-center gap-2 font-mono">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {activeSubTab === 'code' && (
            <form onSubmit={handleSaveCode} className="space-y-4">
              {securityStatus.hasCodeSet && (
                <div className="space-y-1.5">
                  <label className="text-xs font-mono text-zinc-400 block">
                    Code actuel *
                  </label>
                  <div className="relative">
                    <input
                      type={showCurrent ? 'text' : 'password'}
                      value={currentCode}
                      onChange={(e) => setCurrentCode(e.target.value)}
                      placeholder="Saisissez votre code actuel"
                      className="w-full px-3.5 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-white text-sm font-mono focus:border-emerald-500 outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowCurrent(!showCurrent)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                    >
                      {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-mono text-zinc-400 block">
                  {securityStatus.hasCodeSet ? 'Nouveau code de connexion *' : 'Code de connexion souhaité *'}
                </label>
                <div className="relative">
                  <input
                    type={showNew ? 'text' : 'password'}
                    value={newCode}
                    onChange={(e) => setNewCode(e.target.value)}
                    placeholder="Min. 4 chiffres ou caractères (ex: 2408)"
                    className="w-full px-3.5 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-white text-sm font-mono focus:border-emerald-500 outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNew(!showNew)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                  >
                    {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-[10px] font-mono text-zinc-500">
                  Peut être un code PIN à 4 ou 6 chiffres, ou une combinaison personnalisée.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-mono text-zinc-400 block">
                  Confirmer le code *
                </label>
                <input
                  type={showNew ? 'text' : 'password'}
                  value={confirmCode}
                  onChange={(e) => setConfirmCode(e.target.value)}
                  placeholder="Confirmez le code saisi"
                  className="w-full px-3.5 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-white text-sm font-mono focus:border-emerald-500 outline-none"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg bg-zinc-900 hover:bg-zinc-850 text-zinc-400 hover:text-white text-xs font-mono transition-colors cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={isLoading || !newCode.trim()}
                  className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-black font-bold font-mono text-xs uppercase tracking-wider flex items-center gap-2 transition-all cursor-pointer"
                >
                  <Save className="w-4 h-4" />
                  {isLoading ? 'Enregistrement...' : 'Enregistrer le code'}
                </button>
              </div>
            </form>
          )}

          {activeSubTab === 'autolock' && (
            <div className="space-y-4">
              <p className="text-xs text-zinc-300 leading-relaxed font-mono">
                Choisissez quand le streaming dashboard doit se reverrouiller automatiquement pour protéger votre session :
              </p>

              <div className="space-y-2">
                {[
                  { value: 0, label: 'À la fermeture de l\'onglet ou du navigateur (recommandé)' },
                  { value: 15, label: 'Après 15 minutes d\'inactivité' },
                  { value: 30, label: 'Après 30 minutes d\'inactivité' },
                  { value: 60, label: 'Après 1 heure d\'inactivité' },
                  { value: -1, label: 'Uniquement lors d\'un verrouillage manuel (bouton Verrouiller)' },
                ].map((opt) => (
                  <label
                    key={opt.value}
                    onClick={() => setAutoLockMinutes(opt.value)}
                    className={`flex items-center gap-3 p-3 rounded-xl border text-xs font-mono cursor-pointer transition-all ${
                      autoLockMinutes === opt.value
                        ? 'bg-emerald-950/30 border-emerald-500/60 text-emerald-200'
                        : 'bg-zinc-900/50 hover:bg-zinc-900 border-zinc-850 text-zinc-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="autolock_setting"
                      checked={autoLockMinutes === opt.value}
                      onChange={() => setAutoLockMinutes(opt.value)}
                      className="text-emerald-500 focus:ring-0 cursor-pointer"
                    />
                    <span>{opt.label}</span>
                  </label>
                ))}
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={handleSaveAutoLock}
                  disabled={isLoading}
                  className="px-4 py-2 rounded-lg bg-white hover:bg-zinc-200 text-black font-bold font-mono text-xs uppercase tracking-wider flex items-center gap-2 transition-all cursor-pointer"
                >
                  <Save className="w-4 h-4" />
                  Appliquer le délai
                </button>
              </div>
            </div>
          )}

          {activeSubTab === 'disable' && securityStatus.hasCodeSet && (
            <div className="space-y-4">
              <div className="p-3.5 rounded-xl bg-amber-950/30 border border-amber-800/40 text-xs font-mono text-amber-200 space-y-1">
                <div className="font-bold flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4 text-amber-400" />
                  Gestion de l'accès au terminal
                </div>
                <p className="text-[11px] text-zinc-300">
                  Vous pouvez temporairement suspendre la demande de code ou supprimer définitivement le code enregistré.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-mono text-zinc-400 block">
                  Code de connexion actuel (requis pour valider) *
                </label>
                <input
                  type="password"
                  value={currentCode}
                  onChange={(e) => setCurrentCode(e.target.value)}
                  placeholder="Code actuel"
                  className="w-full px-3.5 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-white text-sm font-mono focus:border-red-500 outline-none"
                />
              </div>

              <div className="pt-2 flex flex-col sm:flex-row gap-2.5">
                {securityStatus.enabled ? (
                  <button
                    type="button"
                    onClick={() => handleToggleProtection(false)}
                    disabled={isLoading || !currentCode.trim()}
                    className="flex-1 py-2.5 px-3 rounded-lg bg-zinc-900 hover:bg-zinc-850 disabled:opacity-50 text-amber-300 border border-amber-900/50 font-mono text-xs font-semibold transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    <Unlock className="w-4 h-4" />
                    Désactiver temporairement
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleToggleProtection(true)}
                    disabled={isLoading || !currentCode.trim()}
                    className="flex-1 py-2.5 px-3 rounded-lg bg-zinc-900 hover:bg-zinc-850 disabled:opacity-50 text-emerald-300 border border-emerald-900/50 font-mono text-xs font-semibold transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    <Lock className="w-4 h-4" />
                    Réactiver la protection
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleRemoveCode}
                  disabled={isLoading || !currentCode.trim()}
                  className="flex-1 py-2.5 px-3 rounded-lg bg-red-950/60 hover:bg-red-900/80 disabled:opacity-50 text-red-200 border border-red-800/60 font-mono text-xs font-semibold transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <Trash2 className="w-4 h-4" />
                  Supprimer le code
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
