export function ecologyHash(x:number,y:number,salt:number):number {
  let n=Math.imul(Math.round(x),73856093)^Math.imul(Math.round(y),19349663)^Math.imul(salt,83492791);
  n=Math.imul(n^(n>>>16),2246822507);n^=n>>>13;return (n>>>0)/4294967296;
}
