import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Ejecuta `fn` al montar, cada `intervalS` segundos y cuando cambian `deps`.
 * Devuelve { data, error, loading, updatedAt, refresh }.
 */
export function usePolling(fn, intervalS, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true, updatedAt: null });
  const seq = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const refresh = useCallback(async () => {
    const id = ++seq.current;
    try {
      const data = await fnRef.current();
      if (id === seq.current) setState({ data, error: null, loading: false, updatedAt: Date.now() });
    } catch (error) {
      if (id === seq.current) setState((s) => ({ ...s, error, loading: false }));
    }
  }, []);

  // No se vacía la data al cambiar el intervalo: solo se reprograma
  useEffect(() => {
    refresh();
    const t = intervalS > 0 ? setInterval(refresh, intervalS * 1000) : null;
    return () => { clearInterval(t); seq.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, intervalS]);

  return { ...state, refresh };
}
