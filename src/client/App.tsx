import { AppShell, Anchor, Container, Group, Text } from '@mantine/core';
import { IconSwords } from '@tabler/icons-react';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { Home } from './pages/Home';
import { SessionPage } from './pages/Session';
import { AdminLogin } from './pages/AdminLogin';
import { AdminHome } from './pages/Admin';
import { AdminSessionPage } from './pages/AdminSession';
import { HistoryPage } from './pages/History';
import { HelpPage } from './pages/Help';
import { IdentityProvider, NamePrompt, useIdentity } from './identity';
import { SiteGate } from './SiteGate';

export function App() {
  const isAdminRoute = useLocation().pathname.startsWith('/admin');
  // Admin pages have their own password; everything else sits behind the site password.
  if (isAdminRoute) {
    return (
      <IdentityProvider observe>
        <Shell />
      </IdentityProvider>
    );
  }
  return (
    <SiteGate>
      <IdentityProvider>
        <Shell />
      </IdentityProvider>
    </SiteGate>
  );
}

function Shell() {
  const { identity, logout } = useIdentity();
  const { pathname } = useLocation();
  const isAdminRoute = pathname.startsWith('/admin');
  const isHelp = pathname === '/help';

  return (
    <AppShell header={{ height: 52 }} padding="md">
      <AppShell.Header
        style={{
          borderBottom: 'none',
          backgroundImage: 'linear-gradient(90deg, var(--mantine-color-teal-5), var(--mantine-color-cyan-5))',
          backgroundSize: '100% 3px',
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'bottom',
        }}
      >
        <Container size="sm" h="100%">
          <Group h="100%" justify="space-between">
            <Anchor component={Link} to={isAdminRoute ? '/admin' : '/'} underline="never">
              <Group gap={6}>
                <IconSwords size={20} stroke={2} color="var(--mantine-color-teal-4)" />
                <Text fw={800} fz="lg" className="brand">
                  Just Fucking Roll
                </Text>
                {isAdminRoute && (
                  <Text size="xs" c="dimmed" mt={3}>
                    loot officer
                  </Text>
                )}
              </Group>
            </Anchor>
            <Group gap="sm">
              {identity && (
                <Text size="sm" c="dimmed">
                  <Text span c="teal.3" fw={600}>
                    {identity.username}
                  </Text>{' '}
                  <Anchor component="button" size="xs" c="dimmed" onClick={logout}>
                    (log out)
                  </Anchor>
                </Text>
              )}
              {isAdminRoute ? (
                <Anchor component={Link} to="/admin" size="sm" c="dimmed" underline="never">
                  Admin
                </Anchor>
              ) : (
                <Anchor component={Link} to="/help" size="sm" c="dimmed" underline="never">
                  How it works
                </Anchor>
              )}
            </Group>
          </Group>
        </Container>
      </AppShell.Header>
      <AppShell.Main style={{ background: 'transparent' }}>
        <Container size="sm">
          {!identity && !isAdminRoute && !isHelp ? (
            <NamePrompt />
          ) : (
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/help" element={<HelpPage />} />
              <Route path="/s/:sessionId" element={<SessionPage />} />
              <Route path="/admin/login" element={<AdminLogin />} />
              <Route path="/admin" element={<AdminHome />} />
              <Route path="/admin/s/:sessionId" element={<AdminSessionPage />} />
              <Route path="/admin/seasons/:seasonId/history" element={<HistoryPage />} />
              <Route path="*" element={<Text c="dimmed">Not found</Text>} />
            </Routes>
          )}
        </Container>
      </AppShell.Main>
    </AppShell>
  );
}
