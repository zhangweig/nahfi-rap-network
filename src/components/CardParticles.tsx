import type {CSSProperties} from 'react';
const count = 16;
/** Decorative points distributed along the card edge, with no hit testing. */
export function CardParticles() {
  return <span className="card-particles" aria-hidden="true">{Array.from({length:count},(_,i)=>{
    const q=i/count*4, side=Math.floor(q), t=q-side;
    const x=side===0?t*100:side===1?100:side===2?(1-t)*100:0;
    const y=side===0?0:side===1?t*100:side===2?100:(1-t)*100;
    return <i key={i} style={{'--x':`${x}%`,'--y':`${y}%`,'--delay':`${-(i*0.31)%4}s`,'--size':`${i%4===0?3:2}px`} as CSSProperties}/>;
  })}</span>;
}
