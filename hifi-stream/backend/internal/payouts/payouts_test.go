package payouts

import "testing"

func TestUserCentricSplit(t *testing.T) {
	payments := []Payment{
		{UserID: "alice", AmountCents: 1000},               // member, listens to A and B
		{UserID: "bob", AmountCents: 1000},                 // member, listens only to C
		{UserID: "carol", AmountCents: 1000},               // member, listened to nothing
		{UserID: "alice", ArtistID: "B", AmountCents: 500}, // direct sub
	}
	listening := Listening{
		"alice": {"A": 3 * 60_000, "B": 1 * 60_000},
		"bob":   {"C": 100 * 60_000}, // heavy listening still only moves bob's own money
	}
	res := Compute(payments, listening, 3000, 1000)

	want := map[string]Earnings{
		"A": {MembershipCents: 525},
		"B": {MembershipCents: 175, DirectCents: 450},
		"C": {MembershipCents: 700},
	}
	for id, w := range want {
		if res.Artists[id] != w {
			t.Errorf("artist %s: got %+v, want %+v", id, res.Artists[id], w)
		}
	}
	if res.PlatformCents != 3*300+50 {
		t.Errorf("platform fee: got %d", res.PlatformCents)
	}
	if res.UnallocatedCents != 700 {
		t.Errorf("unallocated: got %d", res.UnallocatedCents)
	}
}

func TestSplitIsExact(t *testing.T) {
	parts := split(100, map[string]int64{"a": 1, "b": 1, "c": 1})
	var sum int64
	for _, c := range parts {
		sum += c
	}
	if sum != 100 {
		t.Fatalf("parts sum to %d, want 100: %v", sum, parts)
	}
	if parts["a"] != 34 || parts["b"] != 33 || parts["c"] != 33 {
		t.Fatalf("remainder not assigned deterministically: %v", parts)
	}
}
