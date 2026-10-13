// Botones de giro manual para las vistas 3D (además de arrastrar). stage = ref a un objeto con rotateBy/setAuto/reset/auto.
import { useEffect, useState } from 'react';

/** Botones para girar la vista a mano (además de arrastrar con el ratón o el dedo). */
export function OrbitButtons({ stage, pos = 'right-3 bottom-3' }) {
  const [auto, setAuto] = useState(() => !!stage?.current?.auto);
  useEffect(() => { const t = setTimeout(() => setAuto(!!stage?.current?.auto), 100); return () => clearTimeout(t); }, [stage]);
  const s = () => stage?.current;
  const B = 'w-7 h-7 grid place-items-center rounded-md bg-[rgba(4,16,20,.75)] border border-[rgba(60,198,218,.35)] text-[#A5E4EE] hover:bg-[rgba(15,149,171,.35)] text-[13px] leading-none';
  return (
    <div className={`absolute ${pos} z-30 flex items-center gap-1.5`} onPointerDown={(e) => e.stopPropagation()}>
      <span className="text-[10px] text-[#7fa7ae] mr-1 hidden sm:inline">arrastra para girar</span>
      <button type="button" className={B} title="Girar a la izquierda" aria-label="Girar a la izquierda" onClick={() => s()?.rotateBy(-Math.PI / 4)}>⟲</button>
      <button type="button" className={B} title="Girar a la derecha" aria-label="Girar a la derecha" onClick={() => s()?.rotateBy(Math.PI / 4)}>⟳</button>
      <button type="button" className={B} title="Vista inicial" aria-label="Vista inicial" onClick={() => s()?.reset()}>⌂</button>
      <button type="button" className={B} title={auto ? 'Detener giro automático' : 'Activar giro automático'} aria-label="Giro automático" aria-pressed={auto} onClick={() => { const v = !auto; s()?.setAuto(v); setAuto(v); }}>{auto ? '❚❚' : '▶'}</button>
    </div>
  );
}

