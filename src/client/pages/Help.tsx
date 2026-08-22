import { Accordion, Alert, List, Stack, Table, Text, Title } from '@mantine/core';
import { SectionCard } from '../components/SectionCard';
import { TierBadge } from '../components/TierBadge';
import { Tier, TIER_HINT } from '../../shared/types';

const TIERS: Tier[] = ['greed', 'equip', 'need', 'dibs'];

export function HelpPage() {
  return (
    <Stack gap="lg">
      <Title order={3}>How this works (read it once)</Title>

      <SectionCard title="Why “just fucking roll”?">
        <Text size="sm" mb="xs">
          Loot drama never came from the loot. It came from people playing each other instead of rolling honestly. You know the moves:
        </Text>
        <List size="sm" spacing={4}>
          <List.Item>
            <b>The hover</b> — mouse parked on Need until the last second, hoping nobody else clicks so it's free.
          </List.Item>
          <List.Item>
            <b>The hoard</b> — saving your Need all night for a drop that never comes, then sulking at the end.
          </List.Item>
          <List.Item>
            <b>The trash Need</b> — burning it on the first shiny thing, then asking why the good item isn't yours.
          </List.Item>
          <List.Item>
            <b>The poll</b> — “I'll only Need if nobody else is.” That's not a roll, that's a negotiation.
          </List.Item>
        </List>
        <Text size="sm" mt="sm" mb="xs">
          So here, none of that works:
        </Text>
        <List size="sm" spacing={4}>
          <List.Item>
            <b>Nobody sees anyone else's roll</b> until the countdown ends. Not who's hovering, not how many picked Need. Nothing.
          </List.Item>
          <List.Item>
            <b>Results show who won, not how.</b> Only the loot officer sees tiers and dice.
          </List.Item>
          <List.Item>
            <b>Your pre-picks are private</b> and pre-fill your roll, so you decide what an item is worth to you before the pressure's on.
          </List.Item>
          <List.Item>
            <b>Need and Dibs only cost you when you win.</b> Same rules for everyone, every week.
          </List.Item>
        </List>
        <Text size="sm" fw={600} mt="sm">
          Roll what it's worth to you. Nobody can see. Just fucking roll.
        </Text>
      </SectionCard>

      <SectionCard title="Roll types">
        <Text size="sm" c="dimmed" mb="sm">
          When an item comes up you pick one. Highest type present wins; ties within a type are a 1–100 roll.
        </Text>
        <Table verticalSpacing="xs" withRowBorders={false}>
          <Table.Tbody>
            {TIERS.map((t) => (
              <Table.Tr key={t}>
                <Table.Td w={110} style={{ verticalAlign: 'top' }}>
                  <TierBadge tier={t} size="sm" />
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{TIER_HINT[t]}</Text>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </SectionCard>

      <SectionCard title="The one rule to remember">
        <Alert variant="light" color="orange">
          <b>One Need</b> per week (per difficulty). Win with <b>Dibs</b> and it eats your Need. Win with <b>Need</b> and your Dibs is benched for
          the week. Need and Dibs are only spent when you <b>win</b>. Losing costs nothing.
        </Alert>
        <Text size="sm" c="dimmed" mt="sm">
          Dibs comes back each season. Need comes back each week (per difficulty).
        </Text>
      </SectionCard>

      <SectionCard title="Raid night, step by step">
        <List type="ordered" size="sm" spacing="xs">
          <List.Item>
            Open the session and enter your item level. Your real one — it's shown to everyone and it decides Dibs ties. (The loot officer
            can also add you or fix it.)
          </List.Item>
          <List.Item>As bosses die, the loot officer adds them and what dropped. The list updates live.</List.Item>
          <List.Item>
            Optional but smart: next to each upcoming item, pre-pick what you'd roll. It pre-fills when the item comes up; you can still change
            it during the countdown.
          </List.Item>
          <List.Item>When loot's done, everyone gets a ready check. Click the big button.</List.Item>
          <List.Item>
            Items come up one at a time: countdown, pick your roll, result for a few seconds. The loot officer starts each one.
          </List.Item>
          <List.Item>
            Multi-night raid? The session stays open. Next night, more loot gets added and rolled, with the same Need/Dibs state.
          </List.Item>
        </List>
      </SectionCard>

      <SectionCard title="FAQ">
        <Accordion variant="separated">
          <Accordion.Item value="tie">
            <Accordion.Control>How are ties decided?</Accordion.Control>
            <Accordion.Panel>
              Everyone who rolled gets a 1–100 roll; within the highest type present, the highest roll wins. Multiple Dibs: higher item level
              wins, and only an exact tie goes to the dice.
            </Accordion.Panel>
          </Accordion.Item>
          <Accordion.Item value="change">
            <Accordion.Control>Can I change my roll during the countdown?</Accordion.Control>
            <Accordion.Panel>Yes. Click another type, or click the selected one again to withdraw. Only what's selected at zero counts.</Accordion.Panel>
          </Accordion.Item>
          <Accordion.Item value="planned">
            <Accordion.Control>I pre-picked Need on two items. What if I win the first?</Accordion.Control>
            <Accordion.Panel>
              The second one drops a step automatically (Need → Equip, Dibs → Need). You can't roll with something you no longer have.
            </Accordion.Panel>
          </Accordion.Item>
          <Accordion.Item value="tab">
            <Accordion.Control>I closed the tab / my internet hiccuped.</Accordion.Control>
            <Accordion.Panel>
              Your login is held for about 30 seconds, so a reload is fine. After that your name frees up and you just pick it again. Loot,
              Need and Dibs are all on the server; nothing is lost.
            </Accordion.Panel>
          </Accordion.Item>
          <Accordion.Item value="grey">
            <Accordion.Control>My name is greyed out in the picker.</Accordion.Control>
            <Accordion.Panel>
              You're logged in somewhere else (another tab or device). Close that one and wait ~30 seconds, or ask the loot officer to end it.
            </Accordion.Panel>
          </Accordion.Item>
          <Accordion.Item value="see">
            <Accordion.Control>Who can see what?</Accordion.Control>
            <Accordion.Panel>
              Everyone sees who's in, their item level, and who won each item. Nobody but the loot officer sees <i>how</i> it was won or
              anyone else's Need/Dibs status.
            </Accordion.Panel>
          </Accordion.Item>
          <Accordion.Item value="give">
            <Accordion.Control>I won something I don't actually want.</Accordion.Control>
            <Accordion.Panel>
              Tell the loot officer. They can hand it to the runner-up, and your Need/Dibs is refunded if you'd used it. Also: maybe don't roll
              on things you don't want.
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      </SectionCard>
    </Stack>
  );
}
