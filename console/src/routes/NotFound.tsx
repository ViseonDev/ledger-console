import { Link } from 'react-router';

export function NotFound() {
  return (
    <p className="notice">
      Nothing here. <Link to="/">Back to accounts</Link>
    </p>
  );
}
