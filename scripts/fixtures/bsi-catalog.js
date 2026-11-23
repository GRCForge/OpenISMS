'use strict';

// Kleine, selbst geschriebene Testkataloge im Aufbau der BSI-Formate.
// Bewusst KEIN Text aus dem Kompendium oder dem Grundschutz++ - die Kataloge
// werden zur Laufzeit importiert und gehoeren nicht ins Repository.

const kompendiumXml = (extra = '') => `<?xml version="1.0" encoding="UTF-8"?>
<book xmlns="http://docbook.org/ns/docbook" version="5.0">
<info><title>IT-Grundschutz-Kompendium</title></info>
<chapter><title>ISMS Sicherheitsmanagement</title>
<section><title>ISMS.1 Sicherheitsmanagement</title>
<section><title>Beschreibung</title><para>Einleitungstext, keine Anforderung.</para></section>
<section><title>Anforderungen</title>
<section><title>Basis-Anforderungen</title>
<section><title>ISMS.1.A1 Testanforderung Eins (B) [Institutionsleitung] </title>
<para><emphasis role="color:#000000">Erster Absatz &amp; mehr.</emphasis></para>
<para>Zweiter Absatz.</para>
<itemizedlist><listitem><para>Punkt A</para></listitem></itemizedlist>
</section>
<section><title>ISMS.1.A2 ENTFALLEN (B)</title><para>Diese Anforderung ist entfallen.</para></section>
</section>
<section><title>Standard-Anforderungen</title>
<section><title>ISMS.1.A3 Testanforderung Drei (S)</title><para>Text drei.</para></section>
</section>
</section>
</section>
</chapter>
<chapter><title>ORP Organisation und Personal</title>
<section><title>ORP.1 Organisation</title>
<section><title>ORP.1.A1 Testanforderung Org (B) [Zentrale Verwaltung]</title><para>Text org.</para></section>
<section><title>ORP.1.A9 Erhoehter Schutz (H) [IT-Betrieb, ISB]</title><para>Text hoch.</para></section>
</section>
</chapter>
${extra}
</book>`;

const oscalCatalog = () => ({
  catalog: {
    uuid: '00000000-0000-4000-8000-000000000001',
    metadata: { title: 'Testkatalog Grundschutz++', version: '2026-01-01', 'oscal-version': '1.1.3' },
    groups: [
      {
        id: 'GC', title: 'Governance und Compliance',
        groups: [
          {
            id: 'GC.1', title: 'Grundlagen',
            controls: [
              {
                id: 'GC.1.1', title: 'Test-Control Eins',
                params: [{ id: 'gc.1.1-prm1', label: 'Standard', values: ['Testwert'] }],
                props: [
                  { name: 'sec_level', ns: 'https://example.invalid/security_level.csv', value: 'normal-SdT' },
                  { name: 'effort_level', value: '2' },
                ],
                parts: [
                  {
                    id: 'GC.1.1_stm', name: 'statement',
                    props: [
                      { name: 'modal_verb', value: 'MUSS' },
                      { name: 'target_object_categories', value: 'IT-Systeme, Netze' },
                    ],
                    prose: 'Die Institution MUSS etwas nach {{ insert: param, gc.1.1-prm1 }} tun.',
                  },
                  { id: 'GC.1.1_gdn', name: 'guidance', prose: 'Hinweis eins.' },
                ],
                controls: [
                  {
                    id: 'GC.1.1.1', title: 'Unter-Control',
                    props: [{ name: 'sec_level', value: 'erhöht' }],
                    parts: [{ name: 'statement', props: [{ name: 'modal_verb', value: 'SOLLTE' }], prose: 'Unter {{ insert: param, unbekannt }}.' }],
                  },
                ],
              },
            ],
          },
        ],
      },
      { id: 'STM', title: 'Strukturmodellierung', controls: [{ id: 'STM.1', title: 'Direkt in Praktik', parts: [] }] },
    ],
  },
});

module.exports = { kompendiumXml, oscalCatalog };
