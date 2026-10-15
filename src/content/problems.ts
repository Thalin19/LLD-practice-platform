import { Problem } from '../domain/problem.ts';

/** Published definitions are immutable. Change the version when revising a saved statement. */
export const PRACTICE_PROBLEMS: readonly Problem[] = Object.freeze([
  new Problem({
    id: 'parking-lot',
    version: '1',
    rubricVersion: '1',
    title: 'Parking Lot',
    description: [
      'Design the objects and interactions for one parking lot that admits vehicles, issues tickets, calculates fees, and handles exits.',
      'Scope: motorcycles and cars, with a separate spot type for each. Each vehicle occupies one matching spot. Use a unique vehicle identifier. A clock and a simulated payment operation are available; physical gates and real payment integration are outside scope.',
      'Pricing uses a configurable hourly rate for each vehicle type. Charge for each started hour, with a minimum of one hour. Explain any remaining assumptions about time and rate changes.',
      'Describe the design in the five submission sections. Include the entry and exit flows, failure behaviour, and tests. Explain how you would add another vehicle type or pricing rule. No particular class names or design pattern are required.',
    ].join('\n\n'),
    requirements: [
      'Track each spot and whether it is available or occupied; report available capacity by vehicle type.',
      'On entry, allocate one available matching spot and issue a unique active ticket containing the vehicle, assigned spot, and entry time. Reject entry when matching capacity is full without creating a ticket.',
      'Prevent a vehicle from holding two active tickets and prevent two active tickets from occupying the same spot, including overlapping entry requests.',
      'On exit, validate the active ticket and calculate its fee from the entry time, exit time, and applicable hourly rate, rounding up to started hours with a one-hour minimum.',
      'Close the ticket and release its spot only after payment succeeds. A failed payment leaves the ticket active and the spot occupied so the exit can be tried again.',
      'Reject unknown tickets and repeated exits without charging again or releasing an unrelated spot.',
      'Explain tests for full capacity, duplicate entry, fee boundaries, failed payment, repeated exit, and competing allocations. Cover how collaborators such as the clock and payment operation can be tested independently.',
    ],
  }),
  new Problem({
    id: 'vending-machine',
    version: '1',
    rubricVersion: '1',
    title: 'Vending Machine',
    description: [
      'Design a vending machine that sells one product per purchase, accepts coins, dispenses the product, and returns change.',
      'Scope: one customer transaction at a time. Each product has an identifier, price, and stock count. Represent money in integer units of the smallest currency denomination. Supported coin denominations and the machine\'s available change are known at initialization.',
      'The customer selects a product, inserts coins, and requests a purchase. They may cancel before dispensing begins. Product dispensing is a simulated operation that reports either success or a confirmed failure; uncertain physical outcomes are outside scope.',
      'Card payments, network services, and maintenance screens are outside scope. Describe responsibilities, transaction states, money and stock changes, failure handling, and tests in the five submission sections. Explain how another payment method could be added without prescribing a particular pattern.',
    ].join('\n\n'),
    requirements: [
      'Show product prices and availability. Reject unknown or sold-out selections without starting a sale.',
      'Accept supported coins and track the transaction balance. Reject unsupported coins without increasing that balance.',
      'Before dispensing, verify that the selected product remains available, the balance covers its price, and exact change can be returned using the coins available to the transaction. State how inserted coins affect that availability.',
      'If funds are insufficient or change cannot be made, do not dispense or decrement stock; preserve the transaction so the customer can add supported coins or cancel.',
      'On successful dispensing, reduce the selected product stock by one, retain the purchase price, return exact change, update coin holdings consistently, and reset the transaction. A repeated purchase command must not dispense twice for the same transaction.',
      'Cancellation before dispensing refunds the full inserted balance and resets the transaction without changing product stock. A confirmed dispense failure also refunds the full balance and leaves stock unchanged.',
      'Explain tests for invalid selections and coins, insufficient funds, unavailable change, cancellation, dispense failure, and repeated commands. Make the permitted state transitions and money conservation clear.',
    ],
  }),
  new Problem({
    id: 'library-management',
    version: '1',
    rubricVersion: '1',
    title: 'Library Management',
    description: [
      'Design the lending domain for one library branch: finding books, borrowing individual copies, viewing active loans, and returning copies.',
      'Scope: the catalogue and registered active members already exist. A book title may have several physical copies, each with its own identifier. A member may hold at most three active loans. Each loan is due fourteen calendar days after borrowing; use a controllable date source.',
      'Authentication, reservations, fines, notifications, and multiple branches are outside scope. Returning an overdue loan is allowed; expose its due date so the caller can identify that it is overdue.',
      'Describe responsibilities, relationships, borrowing and return interactions, edge cases, and trade-offs in the five submission sections. Explain how borrowing limits or loan periods could vary later. Choose and justify your own classes and interfaces.',
    ].join('\n\n'),
    requirements: [
      'Find books by title or author and show whether copies are available. Distinguish a book\'s catalogue information from each physical copy.',
      'Validate the member and requested copy before borrowing. Reject an unknown member, unknown copy, unavailable copy, or a member who already has three active loans.',
      'A successful borrow creates a unique active loan linked to the member and copy, records the borrow and due dates, and marks that copy unavailable.',
      'Prevent overlapping borrow requests from lending the same copy twice or exceeding a member\'s loan limit. Explain the consistency boundary in the design.',
      'List a member\'s active loans, including copy information and due dates.',
      'Return a copy by its active loan identifier, record the return date, close the loan, and make the copy available. Unknown or already-returned loans must not change availability or close another loan.',
      'Explain tests for multiple copies of one title, loan-limit boundaries, due-date calculation, unavailable copies, competing borrow requests, overdue returns, and repeated returns.',
    ],
  }),
]);
