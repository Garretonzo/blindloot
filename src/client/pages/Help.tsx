import { Accordion, Alert, List, Stack, Table, Text, Title } from '@mantine/core';
import { SectionCard } from '../components/SectionCard';
import { TierBadge } from '../components/TierBadge';
import { Tier, TIER_HINT } from '../../shared/types';

const TIERS: Tier[] = ['greed', 'equip', 'need', 'dibs'];

export function HelpPage() {
  return (
    <Stack gap="lg">
      <Title order={3}>How it works</Title>

      <SectionCard title="Why “blind”?">
        <Text size="sm" mb="xs">
          Loot drama comes from people gaming the system and playing the other raiders (or playing yourselves, congratulations) instead of rolling honestly: waiting to see who else Needs, hovering over
          the button until the last second, saving a Need all night for a drop that never comes, or spending it early on trash and
          regretting it. Blind Loot takes that degen behavior away:
        </Text>
        <List size="sm" spacing={4}>
          <List.Item>
            <b>Nobody sees anyone else's roll.</b> Not during, not who's hovering, not even how many picked Need.
          </List.Item>
          <List.Item>
            <b>Results show who won, not how.</b> Only the loot officer sees the details.
          </List.Item>
          <List.Item>
            <b>Your pre-plans are private</b> and pre-fill your roll, so you decide what an item is worth to you up front in an honest manner.
          </List.Item>
          <List.Item>
            <b>Need and Dibs only cost you when you win</b>, and the rules below are the same for everyone.
          </List.Item>
        </List>
        <Text size="sm" c="dimmed" mt="xs">
          Roll what the item is honestly worth to you. That's the whole point of the system.
        </Text>
      </SectionCard>

      <SectionCard title="Roll types">
        <Text size="sm" c="dimmed" mb="sm">
          When an item comes up you pick one. The highest type present wins; ties within a type are a 1–100 roll.
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
          You only get <b>1 Need</b> per week (per difficulty). Winning with a <b>Dibs</b> uses that Need. Winning with a <b>Need</b> means you can't use your
          Dibs this week. Need and Dibs are only spent when you <b>win</b> with them. Rolling and losing costs nothing.
        </Alert>
        <Text size="sm" c="dimmed" mt="sm">
          Your Dibs comes back each season; your Need comes back each week (per difficulty).
        </Text>
      </SectionCard>

      <SectionCard title="Raid night, step by step">
        <List type="ordered" size="sm" spacing="xs">
          <List.Item>
            Open the session and enter your current item level to join. (The loot officer can also add you, and can correct anyone's item
            level. Item level is shown to everyone and decides Dibs ties.)
          </List.Item>
          <List.Item>As bosses die, the loot officer adds them and what dropped. The list updates live.</List.Item>
          <List.Item>
            Optional: next to each upcoming item, pre-select what you'd roll. It pre-fills your choice when the item comes up. You can still
            change it during the countdown.
          </List.Item>
          <List.Item>When loot is done, everyone gets a ready check.</List.Item>
          <List.Item>
            Items come up one at a time: a countdown runs, you pick your roll type, then the result shows for a few seconds. The loot officer
            starts each item.
          </List.Item>
          <List.Item>Multi-night raid? Loot is distributed night one, the session stays open. The next night, more loot gets added and rolled next time, with the same Need/Dibs state.</List.Item>
        </List>
      </SectionCard>

      <SectionCard title="FAQ">
        <Accordion variant="separated">
          <Accordion.Item value="tie">
            <Accordion.Control>How are ties decided?</Accordion.Control>
            <Accordion.Panel>
              Everyone who rolled gets a 1–100 roll; within the highest type present, the highest roll wins. Multiple people Dibs: the higher item level
              wins, and only an exact tie goes to the roll.
            </Accordion.Panel>
          </Accordion.Item>
          <Accordion.Item value="change">
            <Accordion.Control>Can I change my roll during the countdown?</Accordion.Control>
            <Accordion.Panel>Yes. Click another type, or click the selected one again to withdraw.</Accordion.Panel>
          </Accordion.Item>
          <Accordion.Item value="planned">
            <Accordion.Control>I planned Need on two items. What happens if I win the first?</Accordion.Control>
            <Accordion.Panel>
              Your plan on the second item is automatically dropped one step (Need → Equip, Dibs → Need) so you never roll with something you no
              longer have.
            </Accordion.Panel>
          </Accordion.Item>
          <Accordion.Item value="tab">
            <Accordion.Control>What if I close the tab or lose connection?</Accordion.Control>
            <Accordion.Panel>
              Your login is held for about 30 seconds, so a reload or a blip is fine. After that your name frees up and you just pick it again.
              Your loot, Need and Dibs are all saved on the server.
            </Accordion.Panel>
          </Accordion.Item>
          <Accordion.Item value="grey">
            <Accordion.Control>My name is greyed out in the picker.</Accordion.Control>
            <Accordion.Panel>
              It's logged in somewhere else (another tab or device). Close that one and wait ~30 seconds, or ask the loot officer to end that
              login.
            </Accordion.Panel>
          </Accordion.Item>
          <Accordion.Item value="see">
            <Accordion.Control>Who can see what?</Accordion.Control>
            <Accordion.Panel>
              Everyone sees who's in the session, their item level, and who won each item. Nobody except the loot officer sees <i>how</i> an
              item was won, or anyone else's Need/Dibs status.
            </Accordion.Panel>
          </Accordion.Item>
          <Accordion.Item value="give">
            <Accordion.Control>I won something I actually don't want.</Accordion.Control>
            <Accordion.Panel>
              Tell the loot officer. They can hand it to the runner-up, and your Need/Dibs is refunded if you'd used it.
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      </SectionCard>
    </Stack>
  );
}
