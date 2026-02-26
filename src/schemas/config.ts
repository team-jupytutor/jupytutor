import z from 'zod';
import { PredicateSchema } from './predicate';

export const RuleConfigOverrideSchema = z.object({
  chatEnabled: z
    .boolean()
    .default(false)
    .describe('Whether this cell can have the Jupytutor chat UI invoked.'),
  chatProactive: z
    .boolean()
    .default(true)
    .describe(
      'Whether the chat will automatically open when this cell is executed. If false, the chat can still be invoked manually if chatEnabled is true.'
    ), // TODO not true at the moment! no manual invocation
  instructorNote: z
    .string()
    .default('')
    .describe(
      `
    Context for this cell that will be provided to the LLM. Note that this configuration is visible to students, so do not include sensitive information (e.g., solutions).

    By default, this will clobber any instructor note provided by a previously matched rule. To include existing instructor notes from previously matched rules, insert the string \`{{prior_notes}}\` where you would like them to appear.
  `.trim()
    ), // TODO don't love this inherit mechanism -- rethink the design
  quickResponses: z.array(z.string()).default([])
});

export const ConfigSchema = z.object({
  pluginEnabled: z.boolean().default(false),

  api: z
    .object({
      baseURL: z.url().default('http://localhost:3000/')
    })
    .prefault({}),

  rules: z
    .array(
      z.object({
        _comment: z
          .string()
          .optional()
          .describe('Optional comment describing the purpose of this rule.'),
        when: PredicateSchema.optional().describe(
          'Conditions under which this rule applies. If omitted, the rule always applies.'
        ),
        config: RuleConfigOverrideSchema.partial()
      })
    )
    .default([
      {
        _comment: 'Jupytutor always available, but only when manually invoked',
        config: {
          chatEnabled: true,
          chatProactive: false
        }
      },
      {
        _comment: "Display proactively when there's an error in a code cell",
        when: {
          AND: [
            {
              cellType: 'code'
            },
            {
              hasError: true
            }
          ]
        },
        config: {
          chatEnabled: true,
          chatProactive: true,
          quickResponses: ['Explain this error.']
        }
      },
      {
        _comment:
          "Disable proactive mode when there's an explicit disable tag (best to keep this rule toward the end)",
        when: {
          tags: {
            any: 'jupytutor:disable_proactive'
          }
        },
        config: {
          chatEnabled: false
        }
      },
      {
        _comment:
          "Disable when there's an explicit disable tag (best to keep this rule at the end)",
        when: {
          tags: {
            any: 'jupytutor:disable'
          }
        },
        config: {
          chatEnabled: false
        }
      }
    ])
    .describe(
      'List of rules with conditions (deciding whether the rule should apply to a particular cell) and configurations. Rules are applied in order, with later rules overriding earlier ones (if they apply to a particular cell).'
    ),

  remoteContextGathering: z
    .object({
      enabled: z.boolean().default(true),
      whitelist: z
        .nullable(z.array(z.string()))
        .default(['inferentialthinking.com'])
        .describe(
          'If not null, only these domains will be used for context gathering (overriding blacklist).'
        ),
      blacklist: z
        .array(z.string())
        .default(['data8.org', 'berkeley.edu', 'gradescope.com'])
        .describe(
          'If whitelist is null, these domains will be excluded from context gathering.'
        ),
      jupyterbook: z
        .object({
          urls: z
            .array(z.string())
            .default(['inferentialthinking.com'])
            .describe(
              'These links should be JupyterBook sites, which enables link expansion to retrieve entire chapters and subsections'
            ),
          linkExpansion: z
            .boolean()
            .default(true)
            .describe(
              'If true, will expand JupyterBook links to retrieve entire chapters and subsections'
            )
        })
        .prefault({})
    })
    .prefault({}),

  preferences: z
    .object({
      proactiveEnabled: z
        .boolean()
        .default(true)
        .describe(
          'Global setting to enable or disable proactive chat behavior. Overrides notebook rule configuration.'
        )
    })
    .describe(
      "User preferences set for the plugin; generally shouldn't be included as part of an assignment, but rather set after the notebook has been started by the student."
    )
    .prefault({})
});

export type PluginConfig = z.output<typeof ConfigSchema>;
