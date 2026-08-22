import { AppShell, Anchor, Container, Group, Text } from '@mantine/core';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { Home } from './pages/Home';
import { SessionPage } from './pages/Session';
import { AdminLogin } from './pages/AdminLogin';
import { AdminHome } from './pages/Admin';
import { AdminSessionPage } from './pages/AdminSession';
import { HistoryPage } from './pages/History';
import { IdentityProvider, NamePrompt, useIdentity } from './identity';

export function App() {
  const isAdminRoute = useLocation().pathname.startsWith('/admin');
  return (
    <IdentityProvider observe={isAdminRoute}>
      <Shell />
    </IdentityProvider>
  );
}

function Shell() {
  const { identity, logout } = useIdentity();
  const isAdminRoute = useLocation().pathname.startsWith('/admin');

  return (
    <AppShell header={{ height: 48 }} padding="md">
      <AppShell.Header>
        <Container size="sm" h="100%">
          <Group h="100%" justify="space-between">
            <Anchor component={Link} to="/" fw={600} c="inherit" underline="never">
              Loot
            </Anchor>
            <Group gap="sm">
              {identity && (
                <Text size="sm" c="dimmed">
                  {identity.username}{' '}
                  <Anchor component="button" size="xs" c="dimmed" onClick={logout}>
                    (log out)
                  </Anchor>
                </Text>
              )}
              {isAdminRoute && (
                <Anchor component={Link} to="/admin" size="sm" c="dimmed" underline="never">
                  Admin
                </Anchor>
              )}
            </Group>
          </Group>
        </Container>
      </AppShell.Header>
      <AppShell.Main>
        <Container size="sm">
          {!identity && !isAdminRoute ? (
            <NamePrompt />
          ) : (
            <Routes>
              <Route path="/" element={<Home />} />
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
