import type { ShortScript } from './script'

/**
 * Hand-written facts for the free test Short. They exist so the whole chain (sources → checks → voice → images → music → video)
 * can be tried when the free text model is slow or out of allowance. They are NOT trend data and are never presented as such.
 * The sources are still opened and checked by code, and the script goes through the same controls as a generated one.
 */
export type DemoFact = {
  topic: string
  statement: string
  keyTerms: string[]
  sources: Array<{ url: string; title: string }>
  script: ShortScript
}

export const DEMO_FACTS: DemoFact[] = [
  {
    topic: 'Un día en Venus dura más que su año',
    statement: 'Un día en Venus dura 243 días terrestres, más que su año, que dura 225 días terrestres',
    keyTerms: ['243', 'Venus'],
    sources: [
      { url: 'https://science.nasa.gov/venus/venus-facts/', title: 'NASA: datos sobre Venus' },
      { url: 'https://es.wikipedia.org/wiki/Venus_(planeta)', title: 'Wikipedia: Venus (planeta)' },
    ],
    script: {
      title: 'En Venus, un día dura más que un año',
      description: 'En Venus un día dura 243 días terrestres y un año solo 225. Una curiosidad del sistema solar.',
      hashtags: ['venus', 'espacio', 'curiosidades', 'ciencia'],
      scenes: [
        { narration: 'Un día en Venus dura más que su propio año.', visual: 'El planeta Venus envuelto en nubes amarillentas, visto desde el espacio', onScreenText: 'Venus: 243 días' },
        { narration: 'Venus tarda 243 días terrestres en girar una sola vez sobre sí mismo.', visual: 'Un planeta rocoso girando muy despacio frente a las estrellas', onScreenText: '' },
        { narration: 'Pero solo necesita 225 días terrestres para dar la vuelta completa al Sol.', visual: 'Una órbita luminosa de un planeta alrededor del Sol, vista desde arriba', onScreenText: '' },
        { narration: 'Por eso, allí el amanecer llega antes de que termine el año.', visual: 'Un amanecer naranja sobre un paisaje volcánico árido y brumoso', onScreenText: '' },
        { narration: 'Sigue el canal para descubrir más curiosidades del universo.', visual: 'Un cielo estrellado con la Vía Láctea sobre una montaña', onScreenText: '' },
      ],
    },
  },
  {
    topic: 'La temperatura de un rayo frente a la del Sol',
    statement: 'Un rayo calienta el aire hasta unos 30 000 K, unas cinco veces más que la superficie del Sol',
    keyTerms: ['5 times', 'sun', 'cinco veces', '30 000'],
    sources: [
      { url: 'https://www.weather.gov/safety/lightning-science-overview', title: 'Servicio Meteorológico de EE. UU.: ciencia del rayo' },
      { url: 'https://es.wikipedia.org/wiki/Rayo', title: 'Wikipedia: Rayo' },
    ],
    script: {
      title: 'Un rayo es cinco veces más caliente que el Sol',
      description: 'Un rayo calienta el aire a unos 30 000 K, cinco veces más que la superficie del Sol.',
      hashtags: ['rayo', 'tormenta', 'curiosidades', 'ciencia'],
      scenes: [
        { narration: 'Un rayo es cinco veces más caliente que el Sol.', visual: 'Un rayo brillante cayendo sobre un paisaje oscuro durante una tormenta', onScreenText: 'Rayo: cinco veces el Sol' },
        { narration: 'En un instante calienta el aire hasta unos 30 000 kelvin.', visual: 'El camino luminoso de un rayo atravesando las nubes de tormenta', onScreenText: '' },
        { narration: 'Es unas cinco veces más que la temperatura de la superficie del Sol.', visual: 'El Sol brillante con su superficie en llamas, visto desde el espacio', onScreenText: '' },
        { narration: 'Ese calor expande el aire de golpe y produce el trueno que escuchas después.', visual: 'Una tormenta eléctrica sobre el mar al anochecer', onScreenText: '' },
        { narration: 'Sigue el canal para descubrir más curiosidades de la naturaleza.', visual: 'Un cielo despejado al atardecer sobre un campo verde', onScreenText: '' },
      ],
    },
  },
]
