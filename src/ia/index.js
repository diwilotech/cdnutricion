// Herramientas de IA de los módulos propios de Nutrición (a mano en nutricion.js, declarativas en control.js). Las de los módulos centrales (Finanzas,
// Marketing…) llegan de Diwilo Modulos (src/lib/central.js → centralTools) y mcp.js las une.
import nutricion from './nutricion.js';
import control from './control.js';

export const TOOLS = [...nutricion, ...control];
