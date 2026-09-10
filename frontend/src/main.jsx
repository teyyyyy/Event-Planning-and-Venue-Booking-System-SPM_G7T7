import React from 'react';
import { createRoot } from 'react-dom/client';
import CoordinatorAssignment from './coordinator_assignment';
import EventOrganiser from './event_organiser';
import './styles.css';

function App() {
	const [activeRole, setActiveRole] = React.useState('organiser');

	return <>
		<div className="role-tabs" role="tablist" aria-label="User role views">
			<button className={activeRole === 'organiser' ? 'active' : ''} onClick={() => setActiveRole('organiser')}>Event organiser</button>
			<button className={activeRole === 'coordinator' ? 'active' : ''} onClick={() => setActiveRole('coordinator')}>Coordinator assignment</button>
		</div>
		{activeRole === 'organiser' ? <EventOrganiser /> : <CoordinatorAssignment />}
	</>;
}

createRoot(document.getElementById('root')).render(<App />);
