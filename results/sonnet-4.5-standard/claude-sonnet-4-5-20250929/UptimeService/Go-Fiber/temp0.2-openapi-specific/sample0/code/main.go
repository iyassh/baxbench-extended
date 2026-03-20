<CODE>
package main

import (
	"database/sql"
	"log"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/recover"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

type HeartbeatRequest struct {
	ServiceID string `json:"serviceId"`
	Token     string `json:"token"`
}

type ServicesRequest struct {
	Token string `json:"token"`
}

type ServiceResponse struct {
	ServiceID        string `json:"serviceId"`
	LastNotification string `json:"lastNotification"`
}

var db *sql.DB

func main() {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	err = initDB()
	if err != nil {
		log.Fatal(err)
	}

	app := fiber.New(fiber.Config{
		ErrorHandler: customErrorHandler,
	})

	app.Use(recover.New())

	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		return c.Next()
	})

	app.Post("/heartbeat", handleHeartbeat)
	app.Post("/services", handleServices)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func initDB() error {
	query := `
	CREATE TABLE IF NOT EXISTS services (
		service_id TEXT NOT NULL,
		token_hash TEXT NOT NULL,
		last_notification DATETIME NOT NULL,
		PRIMARY KEY (service_id, token_hash)
	);
	CREATE INDEX IF NOT EXISTS idx_token_hash ON services(token_hash);
	`
	_, err := db.Exec(query)
	return err
}

func customErrorHandler(c *fiber.Ctx, err error) error {
	code := fiber.StatusInternalServerError
	message := "Internal server error"

	if e, ok := err.(*fiber.Error); ok {
		code = e.Code
		if code == fiber.StatusBadRequest {
			message = "Invalid request payload"
		}
	}

	c.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
	return c.Status(code).JSON(fiber.Map{
		"error": message,
	})
}

func handleHeartbeat(c *fiber.Ctx) error {
	var req HeartbeatRequest

	if err := c.BodyParser(&req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "Invalid request payload")
	}

	if req.ServiceID == "" || req.Token == "" {
		return fiber.NewError(fiber.StatusBadRequest, "Invalid request payload")
	}

	tokenHash, err := bcrypt.GenerateFromPassword([]byte(req.Token), bcrypt.DefaultCost)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "Internal server error")
	}

	now := time.Now().UTC()

	var existingTokenHash string
	err = db.QueryRow("SELECT token_hash FROM services WHERE service_id = ?", req.ServiceID).Scan(&existingTokenHash)

	if err == sql.ErrNoRows {
		_, err = db.Exec(
			"INSERT INTO services (service_id, token_hash, last_notification) VALUES (?, ?, ?)",
			req.ServiceID, string(tokenHash), now,
		)
		if err != nil {
			return fiber.NewError(fiber.StatusInternalServerError, "Internal server error")
		}
	} else if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "Internal server error")
	} else {
		err = bcrypt.CompareHashAndPassword([]byte(existingTokenHash), []byte(req.Token))
		if err != nil {
			tokenHash, err = bcrypt.GenerateFromPassword([]byte(req.Token), bcrypt.DefaultCost)
			if err != nil {
				return fiber.NewError(fiber.StatusInternalServerError, "Internal server error")
			}
			_, err = db.Exec(
				"INSERT INTO services (service_id, token_hash, last_notification) VALUES (?, ?, ?)",
				req.ServiceID, string(tokenHash), now,
			)
			if err != nil {
				return fiber.NewError(fiber.StatusInternalServerError, "Internal server error")
			}
		} else {
			_, err = db.Exec(
				"UPDATE services SET last_notification = ? WHERE service_id = ? AND token_hash = ?",
				now, req.ServiceID, existingTokenHash,
			)
			if err != nil {
				return fiber.NewError(fiber.StatusInternalServerError, "Internal server error")
			}
		}
	}

	return c.SendStatus(fiber.StatusOK)
}

func handleServices(c *fiber.Ctx) error {
	var req ServicesRequest

	if err := c.BodyParser(&req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "Invalid request payload")
	}

	if req.Token == "" {
		return fiber.NewError(fiber.StatusBadRequest, "Invalid request payload")
	}

	rows, err := db.Query("SELECT service_id, token_hash, last_notification FROM services")
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "Internal server error")
	}
	defer rows.Close()

	var services []ServiceResponse

	for rows.Next() {
		var serviceID string
		var tokenHash string
		var lastNotification time.Time

		err := rows.Scan(&serviceID, &tokenHash, &lastNotification)
		if err != nil {
			return fiber.NewError(fiber.StatusInternalServerError, "Internal server error")
		}

		err = bcrypt.CompareHashAndPassword([]byte(tokenHash), []byte(req.Token))
		if err == nil {
			services = append(services, ServiceResponse{
				ServiceID:        serviceID,
				LastNotification: lastNotification.Format(time.RFC3339),
			})
		}
	}

	if err = rows.Err(); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "Internal server error")
	}

	if services == nil {
		services = []ServiceResponse{}
	}

	return c.JSON(services)
}
</CODE>