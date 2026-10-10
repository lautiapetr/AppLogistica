import { useState } from 'react';
import { Package, Building, UserPlus, ArrowRight, ShieldCheck, AlertCircle, CheckCircle2 } from 'lucide-react';
import { supabase } from '../config/supabase';
import { ensureUserProfile, getErrorMessage } from '../services/auth';

type AuthMode = 'login' | 'register-choice' | 'register-company' | 'register-employee';

export const AuthPage = () => {
  const [mode, setMode] = useState<AuthMode>('login');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Estados de los formularios
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [joinCode, setJoinCode] = useState('');

  const clearMessages = () => {
    setError(null);
    setSuccessMsg(null);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    clearMessages();
    setIsLoading(true);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      if (error) throw error;
    } catch (caughtError: unknown) {
      const message = getErrorMessage(caughtError);
      setError(message === 'Invalid login credentials' ? 'Credenciales incorrectas.' : message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegisterCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    clearMessages();
    setIsLoading(true);

    try {
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: {
          data: {
            onboarding_type: 'company',
            company_name: companyName.trim(),
            full_name: fullName.trim(),
          },
        },
      });

      if (authError) throw authError;
      if (!authData.user) throw new Error('No se pudo crear el usuario.');

      if (authData.session) {
        const result = await ensureUserProfile(authData.user);
        if (result.kind === 'company') {
          setSuccessMsg(`¡Empresa creada! Tu código de invitación es: ${result.joinCode}`);
        }
      } else {
        setSuccessMsg(
          'Revisa tu correo para confirmar la cuenta. La empresa se registrará cuando inicies sesión.',
        );
        setPassword('');
        setMode('login');
      }
    } catch (caughtError: unknown) {
      setError(getErrorMessage(caughtError));
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegisterEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    clearMessages();
    setIsLoading(true);

    try {
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: {
          data: {
            onboarding_type: 'employee',
            invitation_code: joinCode.trim().toUpperCase(),
            full_name: fullName.trim(),
          },
        },
      });

      if (authError) throw authError;
      if (!authData.user) throw new Error('No se pudo crear el usuario.');

      if (authData.session) {
        await ensureUserProfile(authData.user);
        setSuccessMsg(
          '¡Solicitud enviada! Un administrador debe aprobar tu cuenta antes de que puedas ingresar.',
        );
      } else {
        setSuccessMsg(
          'Revisa tu correo para confirmar la cuenta. La solicitud se enviará cuando inicies sesión.',
        );
        setPassword('');
        setMode('login');
      }
    } catch (caughtError: unknown) {
      setError(getErrorMessage(caughtError));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 selection:bg-[var(--color-primary)]/20 selection:text-[var(--color-primary)]">
      <div className="max-w-md w-full">
        
        {/* Logo / Header */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 bg-[var(--color-primary)] rounded-2xl flex items-center justify-center shadow-lg shadow-[var(--color-primary)]/30 mb-4">
            <Package size={32} className="text-white" />
          </div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">LogisPro</h1>
          <p className="text-slate-500 mt-2 text-center">Plataforma integral de gestión logística</p>
        </div>

        {/* Notificaciones de UI */}
        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-100 rounded-xl flex items-start gap-3 animate-in fade-in slide-in-from-top-2">
            <AlertCircle size={20} className="text-red-600 shrink-0 mt-0.5" />
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}
        {successMsg && (
          <div className="mb-4 p-4 bg-emerald-50 border border-emerald-100 rounded-xl flex items-start gap-3 animate-in fade-in slide-in-from-top-2">
            <CheckCircle2 size={20} className="text-emerald-600 shrink-0 mt-0.5" />
            <p className="text-sm text-emerald-800">{successMsg}</p>
          </div>
        )}

        {/* Card Principal */}
        <div className="bg-white rounded-3xl shadow-xl shadow-slate-200/50 border border-slate-100 overflow-hidden relative">
          
          {/* Indicador de carga superior */}
          {isLoading && <div className="absolute top-0 left-0 h-1 bg-[var(--color-primary)] animate-pulse w-full"></div>}

          <div className="p-8">
            
            {/* =========================================
                MODO: INICIAR SESIÓN 
                ========================================= */}
            {mode === 'login' && (
              <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                <h2 className="text-xl font-bold text-slate-900 mb-6">Iniciar Sesión</h2>
                <form onSubmit={handleLogin} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Correo Electrónico</label>
                    <input type="email" value={email} onChange={e => setEmail(e.target.value)} required className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-[var(--color-primary)]/20 focus:border-[var(--color-primary)] outline-none transition-all" placeholder="usuario@empresa.com" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Contraseña</label>
                    <input type="password" value={password} onChange={e => setPassword(e.target.value)} required className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-[var(--color-primary)]/20 focus:border-[var(--color-primary)] outline-none transition-all" placeholder="••••••••" />
                  </div>
                  <button disabled={isLoading} className="w-full py-3 px-4 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white rounded-xl font-medium transition-all shadow-md shadow-[var(--color-primary)]/20 flex items-center justify-center gap-2 mt-6">
                    {isLoading ? 'Verificando credenciales...' : 'Ingresar al Panel'} <ArrowRight size={18} />
                  </button>
                </form>
                <div className="mt-8 text-center text-sm text-slate-500">
                  ¿No tienes una cuenta? <button onClick={() => { setMode('register-choice'); clearMessages(); }} className="text-[var(--color-primary)] font-semibold hover:underline">Regístrate aquí</button>
                </div>
              </div>
            )}

            {/* =========================================
                MODO: ELEGIR TIPO DE REGISTRO 
                ========================================= */}
            {mode === 'register-choice' && (
              <div className="animate-in fade-in slide-in-from-right-4 duration-500">
                <h2 className="text-xl font-bold text-slate-900 mb-2">Comienza con LogisPro</h2>
                <p className="text-sm text-slate-500 mb-6">¿Cómo deseas unirte a la plataforma?</p>
                
                <div className="space-y-3">
                  <button onClick={() => setMode('register-company')} className="w-full flex items-center gap-4 p-4 rounded-2xl border-2 border-slate-100 hover:border-[var(--color-primary)] hover:bg-[var(--color-primary)]/5 transition-all text-left group">
                    <div className="w-12 h-12 rounded-full bg-slate-100 group-hover:bg-[var(--color-primary)]/10 flex items-center justify-center shrink-0 transition-colors">
                      <Building size={24} className="text-slate-600 group-hover:text-[var(--color-primary)]" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-slate-900">Crear una nueva empresa</h3>
                      <p className="text-xs text-slate-500 mt-0.5">Soy administrador y quiero configurar mi logística.</p>
                    </div>
                  </button>

                  <button onClick={() => setMode('register-employee')} className="w-full flex items-center gap-4 p-4 rounded-2xl border-2 border-slate-100 hover:border-[var(--color-primary)] hover:bg-[var(--color-primary)]/5 transition-all text-left group">
                    <div className="w-12 h-12 rounded-full bg-slate-100 group-hover:bg-[var(--color-primary)]/10 flex items-center justify-center shrink-0 transition-colors">
                      <UserPlus size={24} className="text-slate-600 group-hover:text-[var(--color-primary)]" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-slate-900">Unirme a una empresa</h3>
                      <p className="text-xs text-slate-500 mt-0.5">Tengo un código de invitación de mi empleador.</p>
                    </div>
                  </button>
                </div>
                
                <button onClick={() => setMode('login')} className="w-full mt-6 text-sm text-slate-500 hover:text-slate-900 transition-colors">
                  Volver al inicio de sesión
                </button>
              </div>
            )}

            {/* =========================================
                MODO: CREAR EMPRESA (ADMINISTRADOR)
                ========================================= */}
            {mode === 'register-company' && (
              <div className="animate-in fade-in slide-in-from-right-4 duration-500">
                <button onClick={() => { setMode('register-choice'); clearMessages(); }} className="text-sm text-slate-500 mb-4 hover:text-slate-900 flex items-center gap-1">
                  ← Volver
                </button>
                <h2 className="text-xl font-bold text-slate-900 mb-1">Registrar Empresa</h2>
                <p className="text-sm text-slate-500 mb-6">Configura tu espacio de trabajo.</p>
                
                <form onSubmit={handleRegisterCompany} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Nombre de la Empresa</label>
                    <input type="text" value={companyName} onChange={e => setCompanyName(e.target.value)} required className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-[var(--color-primary)]/20 focus:border-[var(--color-primary)] outline-none" placeholder="Logística Express S.A." />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Tu Nombre</label>
                      <input type="text" value={fullName} onChange={e => setFullName(e.target.value)} required className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-[var(--color-primary)]/20 focus:border-[var(--color-primary)] outline-none" placeholder="Juan Pérez" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Email (Admin)</label>
                      <input type="email" value={email} onChange={e => setEmail(e.target.value)} required className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-[var(--color-primary)]/20 focus:border-[var(--color-primary)] outline-none" placeholder="juan@empresa.com" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Contraseña Segura</label>
                    <input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-[var(--color-primary)]/20 focus:border-[var(--color-primary)] outline-none" placeholder="••••••••" />
                  </div>
                  <button disabled={isLoading} className="w-full py-3 px-4 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white rounded-xl font-medium transition-all shadow-md shadow-[var(--color-primary)]/20 mt-6">
                    {isLoading ? 'Registrando...' : 'Crear Empresa y Continuar'}
                  </button>
                </form>
              </div>
            )}

            {/* =========================================
                MODO: UNIRSE A EMPRESA (EMPLEADO)
                ========================================= */}
            {mode === 'register-employee' && (
              <div className="animate-in fade-in slide-in-from-right-4 duration-500">
                <button onClick={() => { setMode('register-choice'); clearMessages(); }} className="text-sm text-slate-500 mb-4 hover:text-slate-900 flex items-center gap-1">
                  ← Volver
                </button>
                <h2 className="text-xl font-bold text-slate-900 mb-1">Unirse al Equipo</h2>
                <p className="text-sm text-slate-500 mb-6">Ingresa el código proporcionado por tu administrador.</p>
                
                <form onSubmit={handleRegisterEmployee} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1 flex items-center gap-2">
                      <ShieldCheck size={16} className="text-emerald-600" />
                      Código de Ingreso (Join Code)
                    </label>
                    <input type="text" value={joinCode} onChange={e => setJoinCode(e.target.value)} required className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-[var(--color-primary)]/20 focus:border-[var(--color-primary)] outline-none font-mono text-center text-lg tracking-widest uppercase" placeholder="LOG-XXXX" maxLength={8} />
                    <p className="text-xs text-slate-400 mt-1 text-center">Tu cuenta requerirá aprobación tras registrarte.</p>
                  </div>
                  <div className="h-px bg-slate-100 my-4"></div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Tu Nombre Completo</label>
                    <input type="text" value={fullName} onChange={e => setFullName(e.target.value)} required className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-[var(--color-primary)]/20 focus:border-[var(--color-primary)] outline-none" placeholder="María López" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Correo Electrónico</label>
                    <input type="email" value={email} onChange={e => setEmail(e.target.value)} required className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-[var(--color-primary)]/20 focus:border-[var(--color-primary)] outline-none" placeholder="maria@correo.com" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Contraseña</label>
                    <input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-[var(--color-primary)]/20 focus:border-[var(--color-primary)] outline-none" placeholder="••••••••" />
                  </div>
                  <button disabled={isLoading} className="w-full py-3 px-4 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white rounded-xl font-medium transition-all shadow-md shadow-[var(--color-primary)]/20 mt-6">
                     {isLoading ? 'Enviando...' : 'Enviar Solicitud de Ingreso'}
                  </button>
                </form>
              </div>
            )}

          </div>
        </div>
        
        <p className="text-center text-xs text-slate-400 mt-6">
          Al acceder, aceptas nuestros términos de servicio y políticas de privacidad.
        </p>
      </div>
    </div>
  );
};
