'use client';

import { useEffect, useState } from 'react';

interface EvalFullNameProps {
  firstName: string;
  lastName: string;
}

export function EvalFullName({ firstName, lastName }: EvalFullNameProps) {
  const [fullName, setFullName] = useState('');

  useEffect(() => {
    setFullName(`${firstName} ${lastName}`);
  }, [firstName, lastName]);

  return <span>{fullName}</span>;
}
