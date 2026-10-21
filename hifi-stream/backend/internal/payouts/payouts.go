// Package payouts splits collected revenue between artists.
//
// Memberships are split "user-centrically": each listener's fee (minus the
// platform fee) goes only to the artists that listener actually played, in
// proportion to their listening time. Direct artist subscriptions go to that
// artist minus a smaller fee. Unlike the pro-rata pool used by the large
// services, one listener's plays can never move money paid by someone else.
package payouts

import "sort"

type Payment struct {
	UserID      string
	ArtistID    string // empty for a membership payment
	AmountCents int64
}

// Listening maps listener ID → artist ID → qualifying milliseconds played.
type Listening map[string]map[string]int64

type Earnings struct {
	MembershipCents int64
	DirectCents     int64
}

func (e Earnings) Total() int64 { return e.MembershipCents + e.DirectCents }

type Result struct {
	Artists       map[string]Earnings
	PlatformCents int64
	// UnallocatedCents is membership money from listeners who played nothing
	// that qualified during the period.
	UnallocatedCents int64
}

func Compute(payments []Payment, listening Listening, membershipFeeBps, directFeeBps int64) Result {
	res := Result{Artists: map[string]Earnings{}}
	for _, p := range payments {
		if p.ArtistID != "" {
			fee := p.AmountCents * directFeeBps / 10000
			e := res.Artists[p.ArtistID]
			e.DirectCents += p.AmountCents - fee
			res.Artists[p.ArtistID] = e
			res.PlatformCents += fee
			continue
		}
		fee := p.AmountCents * membershipFeeBps / 10000
		res.PlatformCents += fee
		shares := split(p.AmountCents-fee, listening[p.UserID])
		if shares == nil {
			res.UnallocatedCents += p.AmountCents - fee
			continue
		}
		for artistID, c := range shares {
			e := res.Artists[artistID]
			e.MembershipCents += c
			res.Artists[artistID] = e
		}
	}
	return res
}

// split divides cents in proportion to weights using the largest-remainder
// method, so the parts always add up to exactly cents.
func split(cents int64, weights map[string]int64) map[string]int64 {
	var total int64
	for _, w := range weights {
		if w > 0 {
			total += w
		}
	}
	if total == 0 || cents <= 0 {
		return nil
	}
	type remainder struct {
		id string
		r  int64
	}
	out := make(map[string]int64, len(weights))
	var rems []remainder
	var given int64
	for id, w := range weights {
		if w <= 0 {
			continue
		}
		q := cents * w / total
		out[id] = q
		given += q
		rems = append(rems, remainder{id, cents * w % total})
	}
	sort.Slice(rems, func(i, j int) bool {
		if rems[i].r != rems[j].r {
			return rems[i].r > rems[j].r
		}
		return rems[i].id < rems[j].id
	})
	for i := int64(0); i < cents-given; i++ {
		out[rems[i].id]++
	}
	return out
}
