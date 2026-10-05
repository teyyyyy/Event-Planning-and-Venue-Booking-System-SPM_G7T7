# Role-Based Access Rule

For every new or modified page, UI action, API route, or data-access path:

- Determine permitted roles and event/resource ownership from the customer requirements; do not infer permissions solely from the current UI or incomplete features.
- Authenticate and authorize on the backend before reading or changing protected data. Resolve the role from the authenticated user's profile, never from a client-supplied role or user ID.
- Scope event data and mutations to the authenticated user's ownership or assignment where the requirements require it. Treat frontend visibility as a usability measure, not a security boundary.
- Use the shared guards in `backend/auth.py` where applicable. Keep endpoints closed to roles that have no explicit permission; keep only intentionally public endpoints such as health checks public.
- Add or update the allowed/denied role cases in `test/test_role_access.py` for every new or changed protected route or page, including path-identity cases. Keep the matrix aligned with all five roles: Event Organiser, Event Coordinator, Venue Staff, Technical Support Staff, and Attendee.
- Do not expose unfinished role functionality. Add an Attendee permission only when its corresponding feature is implemented and specified.
